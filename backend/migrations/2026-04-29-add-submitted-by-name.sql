-- Migration: add submitted_by_name to submissions
-- Date: 2026-04-29
-- Why: enable RM/manager/admin to submit listings on behalf of a CP. The
--      column captures who pressed Submit when it wasn't the CP themselves.
--      NULL = CP submitted directly (current behaviour for all existing rows).
--      Non-NULL = staff submitted on behalf, value is the staff member's
--      display name at the moment of submission (denormalised so deletions
--      don't break the audit trail).
-- Idempotent: re-running this script is a no-op.

ALTER TABLE submissions
    ADD COLUMN IF NOT EXISTS submitted_by_name TEXT;

-- Verification (read-only):
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_name = 'submissions'
--      AND column_name = 'submitted_by_name';
--   -- expected: 1 row, data_type=text, is_nullable=YES.
