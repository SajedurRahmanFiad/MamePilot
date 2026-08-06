-- Migration: 2026-08-06_courier_per_courier_defaults.sql
-- Add per-courier default account, category, and payment method settings.
-- Add collected_amount to courier_order_charges for webhook-sourced payment amounts.

-- Per-courier defaults in courier_settings
ALTER TABLE `courier_settings`
  ADD COLUMN IF NOT EXISTS `steadfast_default_account_id` VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `steadfast_default_expense_category_id` VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `steadfast_default_income_category_id` VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `steadfast_default_payment_method` VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS `carrybee_default_account_id` VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `carrybee_default_expense_category_id` VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `carrybee_default_income_category_id` VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `carrybee_default_payment_method` VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS `paperfly_default_account_id` VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `paperfly_default_expense_category_id` VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `paperfly_default_income_category_id` VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `paperfly_default_payment_method` VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS `pathao_default_account_id` VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `pathao_default_expense_category_id` VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `pathao_default_income_category_id` VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `pathao_default_payment_method` VARCHAR(255) NULL;

-- Collected amount from courier webhooks (cod_amount for Steadfast, collected_amount for others)
ALTER TABLE `courier_order_charges`
  ADD COLUMN IF NOT EXISTS `collected_amount` DECIMAL(12,2) NOT NULL DEFAULT 0.00;
