-- New chat log for CometChat messages (both directions). Replaces writes to
-- whatsapp_messages, which is staled out (kept for history, never written again).
-- Every message is PROXIED through our backend (routes/comet.py /send) so the
-- row is attributed to the REAL sender even though all staff share the single
-- 'openhouse' CometChat identity.
CREATE TABLE IF NOT EXISTS chat_messages (
    id              SERIAL PRIMARY KEY,
    direction       VARCHAR(10) NOT NULL,           -- 'inbound' (from CP) | 'outbound' (from staff)
    cp_id           INTEGER REFERENCES channel_partners(id),
    sender_uid      VARCHAR(64) NOT NULL,           -- 'cp_<id>' or 'openhouse'
    -- Which human staff member sent an OUTBOUND message (the shared 'openhouse'
    -- CometChat identity hides this from CometChat itself). NULL for inbound
    -- (the CP is the sender — see cp_id/sender_uid). staff_id is a cp_id for
    -- admins and an rm_id for manager/rm, so staff_type disambiguates the
    -- namespace; staff_phone is snapshotted (survives actor-row deletion).
    staff_id        INTEGER,
    staff_type      VARCHAR(20),                    -- 'admin' | 'manager' | 'rm'
    staff_phone     VARCHAR(20),
    body            TEXT,
    comet_message_id VARCHAR(120) UNIQUE,           -- CometChat message id (dedup)
    conversation_id VARCHAR(120),
    submission_id   INTEGER,
    sent_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Idempotent add for an already-created table (pre-dates the staff_* columns).
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS staff_type  VARCHAR(20);
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS staff_phone VARCHAR(20);
CREATE INDEX IF NOT EXISTS idx_chat_cp         ON chat_messages(cp_id);
CREATE INDEX IF NOT EXISTS idx_chat_submission ON chat_messages(submission_id);
CREATE INDEX IF NOT EXISTS idx_chat_created    ON chat_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_staff      ON chat_messages(staff_type, staff_id);
