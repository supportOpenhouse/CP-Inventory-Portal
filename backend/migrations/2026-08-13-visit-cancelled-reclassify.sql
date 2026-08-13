-- Reclassify legacy cancelled visits into the new 'Visit Cancelled' stage.
--
-- Before the Visit Cancelled stage existed, a cancelled visit landed in
-- 'Rejected' with status_reason='Visit Cancelled' (both via the cp_inventory
-- sync and manual admin rejects). Those rows now belong in the dedicated
-- 'Visit Cancelled' board stage, with the now-redundant reason cleared.
--
-- Idempotent: re-running matches nothing once the rows have moved.
-- Only genuine cancellations (reason EXACTLY 'Visit Cancelled') are touched;
-- every other Rejected reason is left alone.

BEGIN;

-- Audit trail: one status_change event per reclassified row.
INSERT INTO submission_events
    (submission_id, actor_cp_id, kind, from_status, to_status, text)
SELECT id, NULL, 'status_change', 'Rejected', 'Visit Cancelled',
       'Reclassified from Rejected (reason: Visit Cancelled) into the Visit Cancelled stage.'
FROM submissions
WHERE status = 'Rejected'
  AND status_reason = 'Visit Cancelled'
  AND deleted_at IS NULL;

UPDATE submissions
SET status = 'Visit Cancelled', status_reason = NULL
WHERE status = 'Rejected'
  AND status_reason = 'Visit Cancelled'
  AND deleted_at IS NULL;

COMMIT;
