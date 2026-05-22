-- 2026-05-23: real_status — the granular, real-world lifecycle stage
--
-- submissions.status is constrained to the 7 board stages
--   (Unapproved / Submitted / Visit Scheduled / Visit Completed /
--    Offer Given / Price Rejected / Duplicate Rejected)
-- so the board columns, per-stage counts and status filters keep working.
--
-- real_status preserves the actual stage a listing is in when that stage
-- is finer-grained than the board allows — e.g. 'OH Rejected',
-- 'Negotiation', 'Token Transferred', 'Hold', 'Followup'. It is populated
-- by the May-2026 CSV status clean-up (import_status_update.py) and is
-- shown on the admin board card, right above the price divider.
--
-- Staff-only: it is selected by the /api/admin routes only — the CP-facing
-- /api/submissions routes never read or return it.
--
-- NULL when a row has no distinct real status (status already equals it).

ALTER TABLE submissions ADD COLUMN IF NOT EXISTS real_status VARCHAR(40);
