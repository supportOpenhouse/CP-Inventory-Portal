"""Inbound webhooks from external providers.

Currently:
    POST /api/webhooks/cometchat
        Receives every CometChat 'message_sent' webhook event and persists
        both directions of chat traffic to `chat_messages` for the admin
        Chat Inbox / CP detail panel.

Auth: HTTP Basic Auth (Authorization: Basic base64(user:pass)), matched
against COMET_WEBHOOK_USER / COMET_WEBHOOK_PASS env vars — CometChat does
not send a Bearer token.
"""

import hmac
import logging
import re as _re

from flask import Blueprint, jsonify, request

from activity_log import log_activity
from config import Config
from db import get_app_conn, put_app_conn

log = logging.getLogger(__name__)

bp = Blueprint("webhooks", __name__, url_prefix="/api/webhooks")


_CP_UID = _re.compile(r"^cp_(\d+)$")


def _uid_cp_id(uid):
    m = _CP_UID.match(uid or "")
    return int(m.group(1)) if m else None


def _parse_comet_message(payload):
    """Extract a chat_messages row from a CometChat 'message_sent' webhook, or None."""
    # CometChat envelope: {trigger, data: {<message>}, appId, webhook}. Message
    # fields sit DIRECTLY under data — there is no data.message level.
    msg = (payload or {}).get("data")
    if not isinstance(msg, dict) or msg.get("category") != "message":
        return None
    sender = msg.get("sender")
    receiver = msg.get("receiver")
    staff_uid = Config.COMET_STAFF_UID
    if sender == staff_uid:
        direction, cp_id = "outbound", _uid_cp_id(receiver)
    else:
        direction, cp_id = "inbound", _uid_cp_id(sender)
    meta = (msg.get("data") or {}).get("metadata") or {}
    return {
        "comet_message_id": msg.get("id"),
        "sender_uid": sender,
        "direction": direction,
        "cp_id": cp_id,
        "staff_id": meta.get("staff_id"),
        "body": (msg.get("data") or {}).get("text"),
        "conversation_id": msg.get("conversationId"),
        "sent_at": msg.get("sentAt"),
    }


@bp.post("/cometchat")
def cometchat_webhook():
    """Persist every CometChat message-sent webhook event to `chat_messages`.

    Auth: CometChat sends HTTP Basic Auth (Authorization: Basic
    base64(user:pass)), NOT a Bearer token — Flask parses it into
    request.authorization. Validate against COMET_WEBHOOK_USER/PASS.
    """
    auth = request.authorization
    u, p = Config.COMET_WEBHOOK_USER, Config.COMET_WEBHOOK_PASS
    if (not u or not p or auth is None
            or not hmac.compare_digest((auth.username or "").encode(), u.encode())
            or not hmac.compare_digest((auth.password or "").encode(), p.encode())):
        return jsonify({"error": "unauthorized"}), 401

    row = _parse_comet_message(request.get_json(silent=True) or {})
    if not row or not row["comet_message_id"]:
        return jsonify({"ok": True, "skipped": True}), 200

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO chat_messages
                    (direction, cp_id, sender_uid, staff_id, body,
                     comet_message_id, conversation_id, sent_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s, to_timestamp(%s))
                ON CONFLICT (comet_message_id) DO NOTHING
                RETURNING id
                """,
                (row["direction"], row["cp_id"], row["sender_uid"], row["staff_id"],
                 row["body"], row["comet_message_id"], row["conversation_id"],
                 row["sent_at"]),
            )
            inserted = cur.fetchone()
            if inserted and row["direction"] == "inbound" and row["cp_id"]:
                # log_activity's actor comes from flask.g.user (none here —
                # this is a server-to-server webhook, same as the Interakt
                # handler above), so we record the CP as the entity instead
                # and stash the chat_message id in details.
                log_activity(
                    cur,
                    action="cp_chat_reply",
                    category="cp_chat",
                    entity_type="cp",
                    entity_id=row["cp_id"],
                    details={
                        "cp_id": row["cp_id"],
                        "chat_message_id": inserted["id"],
                        "preview": (row["body"] or "")[:240],
                    },
                )
            conn.commit()
    finally:
        put_app_conn(conn)
    return jsonify({"ok": True}), 200
