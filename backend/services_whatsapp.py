"""Interakt WhatsApp template-message sender.

Used by the CP reminder cron (`/api/cron/send-cp-reminders`) to notify
CPs about pending visit scheduling and seller-meeting deadlines.

Template names registered on the Interakt side:
    - cp_visit_reminder         (params: cp_name, tower_unit_society, days_left)
    - cp_sellermeeting_reminder (params: cp_name, tower_unit_society, days_left)

Sends are synchronous (cron job is already async w.r.t. the request lifecycle)
and return the provider response so the caller can record it in
`cp_reminders_sent.provider_resp`.
"""

import logging

import requests

from config import Config

logger = logging.getLogger(__name__)


_HTTP_TIMEOUT_S = 10


def _normalize_phone(raw: str):
    """Strip non-digits, return (country_code, last10) or (None, None) if invalid."""
    if not raw:
        return None, None
    digits = "".join(c for c in str(raw) if c.isdigit())
    if len(digits) < 10:
        return None, None
    national = digits[-10:]
    if len(digits) > 10:
        cc = digits[:-10]
    else:
        cc = Config.WA_DEFAULT_COUNTRY_CODE
    return cc, national


def send_text(phone: str, message: str) -> dict:
    """Send a free-text WhatsApp session message via Interakt.

    Only valid inside the 24-hour customer-service window — outside that,
    WhatsApp policy forces template messages and Interakt will return an
    error. Caller (the admin endpoint) decides whether to expose this UI;
    we just forward the request and surface the response verbatim.

    Same return shape as send_template().
    """
    if not Config.WA_ENABLED:
        return {"ok": False, "status": 0, "body": "", "skipped": "WA_ENABLED=false"}

    api_key = (Config.INTERAKT_API_KEY or "").strip()
    if not api_key:
        logger.warning("[wa] INTERAKT_API_KEY not configured; skipping send.")
        return {"ok": False, "status": 0, "body": "", "skipped": "no_api_key"}

    cc, national = _normalize_phone(phone)
    if not national:
        logger.warning("[wa] invalid phone %r; skipping send.", phone)
        return {"ok": False, "status": 0, "body": "", "skipped": "invalid_phone"}

    payload = {
        "countryCode": f"+{cc}",
        "phoneNumber": national,
        "type": "Text",
        "data": {"message": str(message)},
    }
    headers = {
        "Authorization": f"Basic {api_key}",
        "Content-Type": "application/json",
    }
    try:
        resp = requests.post(
            Config.INTERAKT_API_URL, json=payload, headers=headers,
            timeout=_HTTP_TIMEOUT_S,
        )
    except requests.RequestException as e:
        logger.exception("[wa] transport error sending text to %s: %s", national, e)
        return {"ok": False, "status": 0, "body": f"transport_error: {e}", "skipped": None}

    body_text = (resp.text or "")[:2000]
    ok = 200 <= resp.status_code < 300
    if ok:
        logger.info("[wa] sent free-text to +%s%s status=%s", cc, national, resp.status_code)
    else:
        logger.warning("[wa] free-text send failed to +%s%s status=%s body=%s",
                       cc, national, resp.status_code, body_text)
    return {"ok": ok, "status": resp.status_code, "body": body_text, "skipped": None}


def send_template(phone: str, template_name: str, params: list) -> dict:
    """Send a WhatsApp template via Interakt.

    Args:
        phone: CP phone (10-digit or with country-code prefix). Strips junk.
        template_name: registered template name on Interakt.
        params: positional template body params, in order ({{1}}, {{2}}, ...).

    Returns:
        dict with keys:
            ok        (bool)
            status    (int — HTTP status, or 0 on transport error)
            body      (str — provider response body, truncated to 2000 chars)
            skipped   (str or None — reason if we didn't send)
    """
    if not Config.WA_ENABLED:
        return {"ok": False, "status": 0, "body": "", "skipped": "WA_ENABLED=false"}

    api_key = (Config.INTERAKT_API_KEY or "").strip()
    if not api_key:
        logger.warning("[wa] INTERAKT_API_KEY not configured; skipping send.")
        return {"ok": False, "status": 0, "body": "", "skipped": "no_api_key"}

    cc, national = _normalize_phone(phone)
    if not national:
        logger.warning("[wa] invalid phone %r; skipping send.", phone)
        return {"ok": False, "status": 0, "body": "", "skipped": "invalid_phone"}

    body_values = [str(p) for p in (params or [])]
    payload = {
        "countryCode": f"+{cc}",
        "phoneNumber": national,
        "type": "Template",
        "template": {
            "name": template_name,
            "languageCode": "en",
            "bodyValues": body_values,
        },
    }

    headers = {
        "Authorization": f"Basic {api_key}",
        "Content-Type": "application/json",
    }

    try:
        resp = requests.post(
            Config.INTERAKT_API_URL, json=payload, headers=headers,
            timeout=_HTTP_TIMEOUT_S,
        )
    except requests.RequestException as e:
        logger.exception("[wa] transport error sending template=%s to %s: %s",
                         template_name, national, e)
        return {"ok": False, "status": 0, "body": f"transport_error: {e}", "skipped": None}

    body_text = (resp.text or "")[:2000]
    ok = 200 <= resp.status_code < 300
    if ok:
        logger.info("[wa] sent template=%s to +%s%s status=%s",
                    template_name, cc, national, resp.status_code)
    else:
        logger.warning(
            "[wa] send failed template=%s to +%s%s status=%s body=%s",
            template_name, cc, national, resp.status_code, body_text,
        )
    return {"ok": ok, "status": resp.status_code, "body": body_text, "skipped": None}
