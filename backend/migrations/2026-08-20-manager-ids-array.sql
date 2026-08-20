-- Multi-manager support: convert rms.manager_id (single integer) into
-- rms.manager_ids (integer[]), so one RM can report to several managers at
-- once and show up in each of their team scopes.
--
-- Existing data is preserved: every non-NULL manager_id becomes a one-element
-- array; NULL (top of chain / unassigned) stays NULL. Application code treats
-- NULL and '{}' identically ("no managers").
--
-- Ships together with the code change that rewrites the recursive "my team"
-- CTEs (routes/admin.py + routes/tickets.py) from `r.manager_id = t.id` to
-- `t.id = ANY(r.manager_ids)`.
--
-- Idempotent: the guard checks for the old column name, and the rename at the
-- end removes it, so re-running is a no-op.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'rms' AND column_name = 'manager_id'
    ) THEN
        -- A single-column FK (if one was ever added by hand) can't survive
        -- the array conversion.
        ALTER TABLE rms DROP CONSTRAINT IF EXISTS rms_manager_id_fkey;
        ALTER TABLE rms
            ALTER COLUMN manager_id TYPE integer[]
            USING CASE WHEN manager_id IS NULL THEN NULL
                       ELSE ARRAY[manager_id] END;
        ALTER TABLE rms RENAME COLUMN manager_id TO manager_ids;
    END IF;
END $$;
