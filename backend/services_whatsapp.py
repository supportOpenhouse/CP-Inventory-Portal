"""Retired stub — Interakt/WhatsApp sending has been replaced by CometChat.

This module is kept only because `backend/routes/cron.py` imports
`send_template` from it at module level (cron.py is out of scope for the
CometChat migration teardown). Cron's reminder job checks its own
kill-switch before calling either function here, so in practice these are
never invoked — they exist purely to keep that import valid.

See `backend/services_cometchat.py` for the current chat integration.
"""


def send_text(phone: str, message: str) -> dict:
    raise RuntimeError("WhatsApp/Interakt retired — migrated to CometChat")


def send_template(phone: str, template_name: str, params: list) -> dict:
    raise RuntimeError("WhatsApp/Interakt retired — migrated to CometChat")
