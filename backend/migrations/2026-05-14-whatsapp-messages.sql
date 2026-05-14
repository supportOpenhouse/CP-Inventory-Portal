-- 2026-05-14: WhatsApp message log (both directions)
--
-- Captures every WhatsApp message exchanged with a CP via Interakt:
--   - outbound: every cron-fired template (cp_visit_reminder /
--     cp_sellermeeting_reminder) that Interakt accepted (HTTP 2xx)
--   - inbound:  every reply Interakt POSTs to /api/webhooks/interakt
--
-- Powers two views:
--   1. The "WhatsApp" section on each submission's admin detail panel —
--      shows the thread for the CP that owns the submission.
--   2. A new admin "WhatsApp Inbox" page that threads messages by phone.
--
-- Inbound messages are best-effort attached to a submission via:
--   match phone -> CP -> CP's most recent in-flight submission
--   (status IN ('Submitted', 'Visit Completed') ORDER BY submitted_at DESC).
-- That's a heuristic: if the CP has multiple in-flight units, the reply
-- attaches to the most recent. Admins can re-link manually via
-- whatsapp_messages.submission_id (free-form, no UI yet).

CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id              SERIAL PRIMARY KEY,
    direction       VARCHAR(10) NOT NULL,           -- 'inbound' | 'outbound'
    phone           VARCHAR(15) NOT NULL,           -- 10-digit national, normalized
    cp_id           INTEGER REFERENCES channel_partners(id) ON DELETE SET NULL,
    submission_id   INTEGER REFERENCES submissions(id) ON DELETE SET NULL,
    template_name   VARCHAR(100),                   -- outbound only
    body            TEXT,                           -- inbound: actual text; outbound: rendered or template name
    body_params     JSONB,                          -- outbound template params: ["First","A-101 - Society","6"]
    provider_msg_id VARCHAR(120),                   -- Interakt's message id (for dedup)
    raw_payload     JSONB,                          -- full webhook / send response
    received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider_msg_id)
);

CREATE INDEX IF NOT EXISTS idx_wa_phone        ON whatsapp_messages(phone);
CREATE INDEX IF NOT EXISTS idx_wa_cp           ON whatsapp_messages(cp_id);
CREATE INDEX IF NOT EXISTS idx_wa_submission   ON whatsapp_messages(submission_id);
CREATE INDEX IF NOT EXISTS idx_wa_received     ON whatsapp_messages(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_dir_received ON whatsapp_messages(direction, received_at DESC);
