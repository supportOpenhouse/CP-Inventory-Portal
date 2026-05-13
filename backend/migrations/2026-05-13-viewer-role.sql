-- Migration: viewer role (city-wise read-only access)
-- Date: 2026-05-13
-- Why: business need is to give a person read-only visibility into ALL
--      submissions of one city (Noida / Gurgaon / Ghaziabad) regardless
--      of who owns the listing. Viewer = staff role with zero mutation
--      rights, scoped strictly by city_id on rms.
-- Idempotent: re-running this script is a no-op.

ALTER TABLE rms
    ADD COLUMN IF NOT EXISTS is_viewer BOOLEAN NOT NULL DEFAULT FALSE;

-- Mutually exclusive with is_manager — a viewer can't also be a manager.
-- Enforced via a CHECK so an admin can't accidentally combine both flags
-- through the Admin Panel.
ALTER TABLE rms
    DROP CONSTRAINT IF EXISTS rms_viewer_manager_xor;
ALTER TABLE rms
    ADD CONSTRAINT rms_viewer_manager_xor
    CHECK (NOT (COALESCE(is_viewer, FALSE) AND COALESCE(is_manager, FALSE)));

-- Viewers must have a city_id (otherwise their scope is empty).
-- We don't enforce as a hard NOT NULL because rms.city_id is nullable in
-- general — only when is_viewer is TRUE. Soft-enforced at the API layer.

-- Verification:
--   SELECT id, name, city_id, is_manager, is_viewer FROM rms WHERE is_viewer = TRUE;
