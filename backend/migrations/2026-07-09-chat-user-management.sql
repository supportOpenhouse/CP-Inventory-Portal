-- Admin-gated CP chat. cp_chat_access = who may chat; chat_requests = CP asks.
CREATE TABLE IF NOT EXISTS cp_chat_access (
    cp_id       INTEGER PRIMARY KEY REFERENCES channel_partners(id),
    enabled     BOOLEAN NOT NULL DEFAULT FALSE,
    enabled_by  INTEGER,
    enabled_at  TIMESTAMPTZ,
    disabled_at TIMESTAMPTZ,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_requests (
    id           SERIAL PRIMARY KEY,
    cp_id        INTEGER NOT NULL REFERENCES channel_partners(id),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at  TIMESTAMPTZ,
    resolved_by  INTEGER
);
-- At most one PENDING (unresolved) request per CP.
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_requests_pending
    ON chat_requests(cp_id) WHERE resolved_at IS NULL;
