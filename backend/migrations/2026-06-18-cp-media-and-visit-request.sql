-- 2026-06-18: CP self-service media sharing + visit-slot requests.
--
-- On a Submitted listing the CP can:
--   - share photos/videos (uploaded to Cloudinary from the browser; we store
--     the IDs/URLs). Photos reuse the existing `photos` array (Cloudinary
--     public_ids); videos go in the new `videos` array as {public_id, url}.
--   - request a visit slot (date + time-of-day + RM). This is a REQUEST only —
--     it does NOT change the listing's stage. The admin still does the official
--     Schedule Visit. We store the request + log a submission_event so it shows
--     in the admin activity panel.

ALTER TABLE submissions
    ADD COLUMN IF NOT EXISTS videos               JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS requested_visit_date DATE,
    ADD COLUMN IF NOT EXISTS requested_visit_slot TEXT,
    ADD COLUMN IF NOT EXISTS requested_rm_id      INTEGER,
    ADD COLUMN IF NOT EXISTS visit_requested_at   TIMESTAMPTZ;
