-- Remove the WhatsApp-reminder idempotency ledger. The reminder cron was the
-- only writer and is deleted. The visible 7-day countdown does not read this
-- table, so dropping it changes no UI.
DROP TABLE IF EXISTS cp_reminders_sent;
