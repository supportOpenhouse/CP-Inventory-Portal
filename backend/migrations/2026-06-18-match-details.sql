-- 2026-06-18: store the matched records behind each submission's match badges.
--
-- The dup-check only recorded booleans (collated_match / submissions_match /
-- perfect_match_at_submit). This adds a JSONB column holding the actual matched
-- rows so the admin UI can show "which properties did this match?" when a badge
-- is clicked.
--
-- Shape: a flat array, one object per matched record:
--   { "source": "inventory"|"submissions"|"properties",
--     "match":  "exact"|"partial",
--     "id": "...", "society": "...", "tower": null, "unit_no": null,
--     "floor": "5", "bhk": "2", "area": 1030 }
--
-- Populated at submit time going forward; run backfill_match_details.py once to
-- fill historical rows.

ALTER TABLE submissions
    ADD COLUMN IF NOT EXISTS match_details JSONB NOT NULL DEFAULT '[]'::jsonb;
