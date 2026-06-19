-- 2026-06-19: track which submissions the match_details backfill has scanned,
-- so re-runs skip already-scanned rows (idempotent across runs, even for rows
-- that scanned to zero matches).

ALTER TABLE submissions
    ADD COLUMN IF NOT EXISTS match_scanned_at TIMESTAMPTZ;

-- Rows that already carry matches were clearly scanned by an earlier backfill
-- run (before this column existed) — mark them so they aren't re-scanned.
UPDATE submissions
   SET match_scanned_at = NOW()
 WHERE match_scanned_at IS NULL
   AND jsonb_array_length(COALESCE(match_details, '[]'::jsonb)) > 0;
