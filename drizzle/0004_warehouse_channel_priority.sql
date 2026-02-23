-- Migration: replace push_stock/push_status with priority in warehouse_channel_rules
-- Schema already updated in 0001_init.sql for fresh installs.
-- This migration only needed for databases created before this schema change.
-- No-op for fresh installs.
SELECT 1;
