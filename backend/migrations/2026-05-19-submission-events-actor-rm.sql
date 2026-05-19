-- Migration: submission_events.actor_rm_id
-- Date: 2026-05-19
-- Why: per-submission timeline used to show "System" for any status change /
--      comment made by an RM or manager. Root cause: submission_events only
--      had `actor_cp_id`, and rm/manager JWTs carry `rm_id` (not `cp_id`),
--      so the actor column was stored NULL and the LEFT JOIN to
--      channel_partners couldn't resolve a name. This adds a parallel
--      `actor_rm_id` column so staff-driven events can carry the actor
--      identity, and the events list query can COALESCE the name across
--      channel_partners and rms.
-- Idempotent: re-running this script is a no-op.

ALTER TABLE submission_events
    ADD COLUMN IF NOT EXISTS actor_rm_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_submission_events_actor_rm
    ON submission_events (actor_rm_id);

-- Verification (read-only):
--   \d submission_events
--   SELECT count(*) FROM submission_events WHERE actor_rm_id IS NOT NULL;
