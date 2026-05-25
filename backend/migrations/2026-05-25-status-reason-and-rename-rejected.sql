-- 2026-05-25: status_reason column + rename 'Duplicate Rejected' → 'Rejected'
--
-- Two changes that go together:
--
-- 1. The board's terminal-reject stage is renamed from 'Duplicate Rejected'
--    to 'Rejected'. It always covered more than just duplicates (Hold,
--    OH Rejected, Seller Rejected, Dead - *, …); the new name reflects that.
--
-- 2. submissions.status_reason holds the sub-category for a 'Rejected' row
--    (one of: Cancelled Post Token, Dead - Legal, Dead - Not Interested,
--    Dead - Sold, Duplicacy, Hold, OH Rejected, Seller Rejected). Staff-only
--    — never exposed on CP-facing routes. The column was created earlier as
--    `rejected_reason`; rename to `status_reason` since the design allows
--    reasons on non-rejected statuses too in the future.
--
-- real_status (added 2026-05-23) is superseded by status_reason and is no
-- longer read or written by application code. It is left in place here so
-- we can audit the migration; a follow-up will DROP it.
--
-- Idempotent.

-- 1. Column rename (only if the source column still exists)
ALTER TABLE submissions RENAME COLUMN rejected_reason TO status_reason;

-- 2. Preserve the 8 known rejection reasons from real_status before the rename
UPDATE submissions
   SET status_reason = real_status
 WHERE status = 'Duplicate Rejected'
   AND real_status IN (
       'Cancelled Post Token','Dead - Legal','Dead - Not Interested',
       'Dead - Sold','Duplicacy','Hold','OH Rejected','Seller Rejected'
   )
   AND (status_reason IS NULL OR status_reason = '');

-- 3. 'Cancelled Post Token' previously projected to 'Offer Given' — it now
--    belongs under Rejected. Move those rows and stamp the reason.
UPDATE submissions
   SET status = 'Rejected', status_reason = 'Cancelled Post Token'
 WHERE status = 'Offer Given'
   AND real_status = 'Cancelled Post Token';

-- 4. Rename the board stage value itself
UPDATE submissions SET status = 'Rejected' WHERE status = 'Duplicate Rejected';

-- 5. Fix in-flight status_change events that reference the old name so the
--    timeline reads coherently after the rename.
UPDATE submission_events
   SET from_status = 'Rejected' WHERE from_status = 'Duplicate Rejected';
UPDATE submission_events
   SET to_status   = 'Rejected' WHERE to_status   = 'Duplicate Rejected';
