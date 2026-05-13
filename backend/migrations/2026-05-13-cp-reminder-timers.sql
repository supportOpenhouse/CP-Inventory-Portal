-- 2026-05-13: CP visit/seller-meeting reminder timers
--
-- Two 7-day timers per submission:
--   1. submitted_stage_at  -> Submitted -> Visit Scheduled    (template: cp_visit_reminder)
--   2. visit_completed_stage_at -> Visit Completed -> next stage (template: cp_sellermeeting_reminder)
--
-- Both timer-start timestamps are DERIVED from submission_events at query
-- time (LATERAL subquery in the list endpoints) — no new columns on
-- submissions are needed. This table only deduplicates the WhatsApp sends.
--
-- One row per (submission, kind, day_number). The cron endpoint inserts
-- ON CONFLICT DO NOTHING and treats a conflict as "already sent" so the
-- job is idempotent even if it runs twice in a day.
--
-- `kind` values:
--   'visit'         -> cp_visit_reminder         (Submitted timer)
--   'seller_meet'   -> cp_sellermeeting_reminder (Visit Completed timer)
--
-- `day_number` values: 1, 2, 4, 7. The spec is "days 1, 2, 4 and 7 of
-- the submission time (not left time)" — i.e. measured forward from
-- when the timer started, not backwards from the 7-day deadline.

CREATE TABLE IF NOT EXISTS cp_reminders_sent (
    id              SERIAL PRIMARY KEY,
    submission_id   INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    kind            VARCHAR(20) NOT NULL,
    day_number      SMALLINT    NOT NULL,
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    provider_resp   TEXT,
    UNIQUE (submission_id, kind, day_number)
);

CREATE INDEX IF NOT EXISTS idx_cp_reminders_sub
    ON cp_reminders_sent(submission_id);
CREATE INDEX IF NOT EXISTS idx_cp_reminders_sent_at
    ON cp_reminders_sent(sent_at DESC);
