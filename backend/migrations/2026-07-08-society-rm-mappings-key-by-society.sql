-- Align society_rm_mappings with the master_societies rework: the upsert now
-- keys on `society` (text) via ON CONFLICT (society), but the table was still
-- PK'd on society_id (NOT NULL) with no unique constraint on society — causing
-- "no unique or exclusion constraint matching the ON CONFLICT specification"
-- in upsert_society_mapping() (bulk-reassign-listing-rm, etc.).
--
-- All existing rows already have a unique, non-null society, so this is safe.

BEGIN;
SET LOCAL lock_timeout = '3s';   -- fail fast rather than block prod writers

-- 1. society (text) becomes the key — enforce NOT NULL.
ALTER TABLE society_rm_mappings ALTER COLUMN society SET NOT NULL;

-- 2. Old key was society_id (PK, NOT NULL); new code no longer writes it.
--    Drop the PK and relax society_id to nullable (legacy/vestigial column).
ALTER TABLE society_rm_mappings DROP CONSTRAINT society_rm_mappings_pkey;
ALTER TABLE society_rm_mappings ALTER COLUMN society_id DROP NOT NULL;

-- 3. Give ON CONFLICT (society) a matching unique constraint.
ALTER TABLE society_rm_mappings
    ADD CONSTRAINT society_rm_mappings_society_key UNIQUE (society);

COMMIT;
