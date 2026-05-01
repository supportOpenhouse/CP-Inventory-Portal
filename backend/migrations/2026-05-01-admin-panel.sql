-- Migration: admin-panel columns on channel_partners + rms
-- Date: 2026-05-01
-- Why: support a new staff admin panel that can:
--      - Force-logout a user (or all users). The auth middleware will reject any
--        JWT whose iat is older than the user's force_logout_at timestamp; the
--        frontend's existing 401 handler then redirects to login.
--      - Gate the new "OH Properties" page per user via can_see_oh_properties.
-- Idempotent: re-running this script is a no-op.

ALTER TABLE channel_partners
    ADD COLUMN IF NOT EXISTS force_logout_at        TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS can_see_oh_properties  BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE rms
    ADD COLUMN IF NOT EXISTS force_logout_at        TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS can_see_oh_properties  BOOLEAN NOT NULL DEFAULT TRUE;

-- Verification (read-only):
--   SELECT table_name, column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_name IN ('channel_partners','rms')
--      AND column_name IN ('force_logout_at','can_see_oh_properties')
--    ORDER BY table_name, column_name;
