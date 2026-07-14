-- Tickets: staff (admin/manager) raise an issue on a submission (or directly to
-- an RM); the assigned RM replies; back-and-forth until the creator/admin closes.
-- Ported from Direct_Inventory, adapted to CP's split staff identity + submissions.
CREATE TABLE IF NOT EXISTS tickets (
    id                BIGSERIAL PRIMARY KEY,
    submission_id     INTEGER REFERENCES submissions(id) ON DELETE SET NULL,  -- NULL = direct-to-RM
    public_id         TEXT,                       -- snapshot of submissions.public_id (display)
    title             TEXT NOT NULL,
    summary           TEXT,
    status            TEXT NOT NULL DEFAULT 'open',   -- 'open' | 'closed'
    awaiting          TEXT,                            -- 'rm' | 'creator' | NULL(closed) — whose turn
    created_by_source TEXT NOT NULL,                   -- 'cp' (admin creator) | 'rm' (manager creator)
    created_by_id     INTEGER NOT NULL,                -- id within the source table
    created_by_name   TEXT,                            -- snapshot (JWT lacks name)
    created_by_phone  TEXT,                            -- snapshot
    assigned_rm_id    INTEGER,                         -- rms.id (effective RM at creation)
    city_id           INTEGER,                         -- snapshot from the submission
    messages          JSONB NOT NULL DEFAULT '[]'::jsonb,  -- reply thread
    last_activity_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- sort key
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at         TIMESTAMPTZ,
    closed_by_source  TEXT,
    closed_by_id      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tickets_submission ON tickets(submission_id);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned_rm ON tickets(assigned_rm_id);
CREATE INDEX IF NOT EXISTS idx_tickets_creator ON tickets(created_by_source, created_by_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
