"""Inbound webhooks from external providers.

Currently:
    POST /api/webhooks/interakt
        Receives every Interakt webhook event. We persist text replies from
        CPs into `whatsapp_messages` so they show up on the admin
        submission detail panel and the new WhatsApp Inbox screen.

Auth: shared secret in `Authorization: Bearer <token>` header (configured
in the Interakt dashboard's webhook settings, matched against
INTERAKT_WEBHOOK_SECRET env var).
"""

import json
import logging

from flask import Blueprint, jsonify, request

from activity_log import log_activity
from config import Config
from db import get_app_conn, put_app_conn

log = logging.getLogger(__name__)

bp = Blueprint("webhooks", __name__, url_prefix="/api/webhooks")


# Interakt webhook event types we care about. Inbound text replies arrive
# as `message_received` (or sometimes `message`). Delivery / read receipts
# arrive as `message_delivered` / `message_read` — we ignore those for now
# (they're noise unless we surface delivery status in the UI).
_INBOUND_EVENT_TYPES = {
    "message_received",
    "message_reply",
    "message",  # observed on some webhook variants
}


def _normalize_phone(raw):
    """Strip non-digits, return last-10 or None."""
    if raw is None:
        return None
    digits = "".join(c for c in str(raw) if c.isdigit())
    return digits[-10:] if len(digits) >= 10 else None


def _check_auth():
    """Accept the secret in any of the places Interakt might put it.

    Interakt's webhook UI has a single "Secret key" field but doesn't
    document precisely how the value reaches us. Empirically it can show
    up as `Authorization: Bearer <secret>`, an `X-Interakt-Secret` /
    `X-Webhook-Secret` header, a `?secret=` query param, or a `secret`
    field in the JSON body. We accept any of them so we don't have to
    redeploy to chase the format.
    """
    secret = (Config.INTERAKT_WEBHOOK_SECRET or "").strip()
    if not secret:
        log.error("[webhook/interakt] INTERAKT_WEBHOOK_SECRET not configured")
        return jsonify({"error": "Webhook not configured"}), 503

    candidates = []
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        candidates.append(auth[7:].strip())
    elif auth:
        candidates.append(auth.strip())
    for h in ("X-Interakt-Secret", "X-Webhook-Secret", "X-Webhook-Token", "X-Sync-Token"):
        v = request.headers.get(h, "").strip()
        if v:
            candidates.append(v)
    qs = request.args.get("secret", "").strip()
    if qs:
        candidates.append(qs)
    body = request.get_json(silent=True) or {}
    if isinstance(body, dict):
        for k in ("secret", "secretKey", "secret_key", "token"):
            v = body.get(k)
            if isinstance(v, str) and v.strip():
                candidates.append(v.strip())

    if any(c == secret for c in candidates):
        return None

    # Debug-on-failure: dump everything we received so we can find where
    # Interakt is actually placing the secret. Header NAMES and value
    # PREFIXES only — we never log the configured server-side secret, and
    # truncate values so a stray credential isn't dumped in full. Remove
    # this block once we've matched the format.
    try:
        hdr_summary = {
            k: (v[:8] + "…" if isinstance(v, str) and len(v) > 8 else v)
            for k, v in request.headers.items()
        }
        body_keys = list(body.keys()) if isinstance(body, dict) else type(body).__name__
        qs_keys = list(request.args.keys())
        log.warning(
            "[webhook/interakt] auth failed (0 candidates matched). "
            "headers=%s qs_keys=%s body_keys=%s body_preview=%s",
            hdr_summary, qs_keys, body_keys,
            (str(body)[:300] if body else "<empty>"),
        )
    except Exception:
        log.exception("[webhook/interakt] auth failed AND debug-dump errored")
    return jsonify({"error": "Unauthorized"}), 401


def _extract_inbound(payload):
    """Pull (phone, text, message_id, timestamp_iso, event_type) from a
    raw Interakt webhook body. Interakt has multiple webhook payload
    variants depending on the event type and account vintage; we look in
    several plausible places before giving up.

    Returns a dict or None (None = not an inbound text we care about).
    """
    if not isinstance(payload, dict):
        return None

    event_type = (
        payload.get("type")
        or payload.get("event")
        or payload.get("eventType")
        or ""
    ).lower()
    if event_type and event_type not in _INBOUND_EVENT_TYPES:
        return None

    # Phone — try multiple paths
    phone = (
        payload.get("phoneNumber")
        or payload.get("phone_number")
        or payload.get("from")
        or (payload.get("data") or {}).get("phoneNumber")
        or (payload.get("data") or {}).get("phone_number")
        or (payload.get("data") or {}).get("from")
        or (payload.get("contact") or {}).get("phoneNumber")
        or (payload.get("contact") or {}).get("phone")
    )
    cc = (
        payload.get("countryCode")
        or payload.get("country_code")
        or (payload.get("data") or {}).get("countryCode")
        or ""
    )
    if cc and phone and not str(phone).startswith(str(cc).lstrip("+")):
        phone = f"{str(cc).lstrip('+')}{phone}"

    norm_phone = _normalize_phone(phone)

    # Message text
    msg = payload.get("message") or (payload.get("data") or {}).get("message") or {}
    text = (
        (msg.get("text") if isinstance(msg, dict) else None)
        or payload.get("text")
        or (payload.get("data") or {}).get("text")
        or (msg.get("body") if isinstance(msg, dict) else None)
    )
    if isinstance(text, dict):
        text = text.get("body") or text.get("text") or json.dumps(text)

    # Non-text messages (image / doc / audio / location) — store a label
    # so the thread shows that something arrived; the raw payload keeps
    # the actual media reference for later.
    if not text and isinstance(msg, dict):
        mtype = msg.get("type") or "media"
        text = f"[{mtype} attached]"

    msg_id = (
        (msg.get("messageId") if isinstance(msg, dict) else None)
        or (msg.get("id") if isinstance(msg, dict) else None)
        or payload.get("messageId")
        or (payload.get("data") or {}).get("messageId")
    )

    timestamp = (
        msg.get("timestamp") if isinstance(msg, dict) else None
    ) or payload.get("timestamp") or (payload.get("data") or {}).get("timestamp")

    if not norm_phone or not text:
        return None
    return {
        "phone": norm_phone,
        "text": str(text)[:4000],
        "message_id": str(msg_id) if msg_id else None,
        "timestamp": timestamp,
        "event_type": event_type or "message",
    }


@bp.post("/interakt")
def interakt_webhook():
    """Persist inbound CP replies to whatsapp_messages and surface them on
    the submission detail panel + the new admin WhatsApp Inbox.

    Always returns 200 once auth passes, even when the payload doesn't
    look like an inbound message — webhooks should ack and move on rather
    than keep the provider retrying noise events.
    """
    auth_err = _check_auth()
    if auth_err is not None:
        return auth_err

    payload = request.get_json(silent=True) or {}
    info = _extract_inbound(payload)
    if not info:
        # Delivery receipt / unknown event — ack and move on.
        return jsonify({"ok": True, "stored": False, "reason": "not_inbound_text"}), 200

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            # Find the CP by phone (last-10-digit normalize). If nothing
            # matches, the row still gets stored — admins can see "unknown
            # number" replies in the inbox and reach out manually.
            cur.execute(
                "SELECT id, name FROM channel_partners WHERE phone = %s LIMIT 1",
                (info["phone"],),
            )
            cp = cur.fetchone()
            cp_id = cp["id"] if cp else None

            # Best-effort attach to the CP's most recent in-flight submission.
            # The reply is most likely about the unit they were just reminded
            # about. If they have no in-flight units, leave submission_id NULL
            # (still searchable in the inbox by phone).
            submission_id = None
            public_id = None
            if cp_id:
                cur.execute(
                    """
                    SELECT id, public_id FROM submissions
                    WHERE cp_id = %s
                      AND deleted_at IS NULL
                      AND status IN ('Submitted', 'Visit Completed')
                    ORDER BY submitted_at DESC
                    LIMIT 1
                    """,
                    (cp_id,),
                )
                row = cur.fetchone()
                if row:
                    submission_id = row["id"]
                    public_id = row.get("public_id")

            # Dedup on Interakt's message id (ON CONFLICT). Webhooks can
            # be retried if our 2xx ack never lands.
            cur.execute(
                """
                INSERT INTO whatsapp_messages
                    (direction, phone, cp_id, submission_id,
                     template_name, body, body_params,
                     provider_msg_id, raw_payload, received_at)
                VALUES ('inbound', %s, %s, %s,
                        NULL, %s, NULL,
                        %s, %s::jsonb, COALESCE(%s::timestamptz, NOW()))
                ON CONFLICT (provider_msg_id) DO NOTHING
                RETURNING id
                """,
                (
                    info["phone"],
                    cp_id,
                    submission_id,
                    info["text"],
                    info["message_id"],
                    json.dumps(payload),
                    info["timestamp"],
                ),
            )
            inserted = cur.fetchone()
            new_id = inserted["id"] if inserted else None

            # Drop a row in activity_log for the submission detail panel +
            # the existing Activity Log page. Skip if the message was a
            # dedup (already-seen Interakt id).
            if new_id and submission_id:
                log_activity(
                    cur,
                    action="cp_whatsapp_reply",
                    category="cp_reminder",
                    entity_uid=public_id,
                    entity_type="submission",
                    entity_id=submission_id,
                    details={
                        "phone": info["phone"],
                        "cp_id": cp_id,
                        "cp_name": cp["name"] if cp else None,
                        "preview": info["text"][:240],
                        "wa_message_id": new_id,
                    },
                )
            conn.commit()
    finally:
        put_app_conn(conn)

    return jsonify({
        "ok": True,
        "stored": bool(new_id),
        "deduped": new_id is None,
        "submission_id": submission_id,
        "cp_id": cp_id,
    }), 200
