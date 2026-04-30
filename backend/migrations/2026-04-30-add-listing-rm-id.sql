-- Migration: add submissions.listing_rm_id
-- Date: 2026-04-30
-- Why: enable per-listing RM override (vs the CP-permanent rm_id on
--      channel_partners). Admin can reassign a single listing or a batch
--      to a different RM without disturbing the CP's permanent assignment.
--      NULL = no override; effective RM falls back to channel_partners.rm_id.
-- Idempotent: re-running this script is a no-op.
--
-- Note: the existing submissions.assigned_rm_id column references
-- channel_partners.id (legacy, when RMs lived in that table) and is
-- currently unused (0 rows). It is intentionally left alone — this new
-- column is the modern path.

ALTER TABLE submissions
    ADD COLUMN IF NOT EXISTS listing_rm_id INTEGER
        REFERENCES rms(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_submissions_listing_rm_id
    ON submissions (listing_rm_id) WHERE listing_rm_id IS NOT NULL;

-- Verification (read-only):
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_name = 'submissions'
--      AND column_name = 'listing_rm_id';
