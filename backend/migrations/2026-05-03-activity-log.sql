-- Migration: activity_log
-- Date: 2026-05-03
-- Why: dashboard-wide activity feed (separate from submission_events,
--      which is the per-submission timeline). Captures mutations across
--      submissions, channel-partner ownership, staff users, notes, etc.
--      Every staff or CP-actored write should append a row here.
-- Idempotent: re-running this script is a no-op.

CREATE TABLE IF NOT EXISTS activity_log (
    id            BIGSERIAL    PRIMARY KEY,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    -- Actor identification. We don't FK these because the actor can be
    -- a CP, an RM/manager (rms table), or 'system' (background job).
    -- The list endpoint JOINs to the right table at read time to fetch
    -- the actor's current name/email/phone for display. We do snapshot
    -- the phone since it's already in the JWT payload (free) and is the
    -- one stable identifier we can show even if the row is later removed.
    actor_id      INTEGER,
    actor_type    VARCHAR(20)  NOT NULL,        -- 'admin' | 'manager' | 'rm' | 'cp' | 'system'
    actor_phone   VARCHAR(20),

    -- What happened.
    action        VARCHAR(80)  NOT NULL,        -- 'status_change', 'reassign_listing_rm', 'add_user', ...
    category      VARCHAR(40)  NOT NULL,        -- 'submission' | 'staff_user' | 'cp_rm' | 'note' | 'auth' | ...
    dashboard     VARCHAR(40)  NOT NULL DEFAULT 'CP Inventory',  -- shape-compatible with the org-wide log convention

    -- Subject (the entity acted upon).
    entity_uid    VARCHAR(40),                  -- human-readable id ('OHLNC0091', 'cp_42', 'rm_7'); used by the UID search filter
    entity_type   VARCHAR(40),                  -- 'submission' | 'channel_partner' | 'rm' | 'cp_note' | 'submission_bulk'
    entity_id     INTEGER,                      -- numeric id when applicable

    -- Free-form structured payload (status from/to, comment text, count of bulk items, etc).
    details       JSONB        NOT NULL DEFAULT '{}'::jsonb
);

-- Default sort = newest first. Most reads page through `created_at DESC`.
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at
    ON activity_log (created_at DESC);

-- Common filter facets.
CREATE INDEX IF NOT EXISTS idx_activity_log_action     ON activity_log (action);
CREATE INDEX IF NOT EXISTS idx_activity_log_category   ON activity_log (category);
CREATE INDEX IF NOT EXISTS idx_activity_log_actor      ON activity_log (actor_type, actor_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_entity_uid ON activity_log (entity_uid);

-- Verification (read-only):
--   SELECT count(*) FROM activity_log;
--   \d activity_log
