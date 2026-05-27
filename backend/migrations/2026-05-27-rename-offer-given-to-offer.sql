-- 2026-05-27: rename board stage value 'Offer Given' -> 'Offer'
--
-- The DB value and all backend code now use the short form 'Offer'. The
-- frontend keeps displaying the literal "Offer Given" via a label override
-- on STAGES — only the stored value changes.
--
-- Idempotent. Re-running on a DB that's already migrated is a no-op.

-- 1. submissions.status — the live board stage.
UPDATE submissions SET status = 'Offer' WHERE status = 'Offer Given';

-- 2. submission_events.from_status / to_status — keep timeline coherent
--    after the rename so old status_change events read the new value.
UPDATE submission_events
   SET from_status = 'Offer' WHERE from_status = 'Offer Given';
UPDATE submission_events
   SET to_status   = 'Offer' WHERE to_status   = 'Offer Given';
