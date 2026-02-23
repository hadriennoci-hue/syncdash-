-- Fix suppliers table: add contact_first_name and contact_last_name columns
-- (migration had a single 'contact' column instead of split first/last name)

ALTER TABLE `suppliers` ADD COLUMN `contact_first_name` TEXT;
ALTER TABLE `suppliers` ADD COLUMN `contact_last_name`  TEXT;
