-- Remove the WhatsApp inbound/outbound message log. WhatsApp is retired; no
-- code references this table after the 2026-07-03 removal. Destroys stored
-- WhatsApp history (accepted).
DROP TABLE IF EXISTS whatsapp_messages;
