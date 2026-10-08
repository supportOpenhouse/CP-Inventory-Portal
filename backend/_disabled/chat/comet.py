"""CometChat auth: provision the caller's CometChat user + return an auth token."""
from flask import Blueprint, g, jsonify, request

from auth import require_auth
from activity_log import log_activity, _actor_from_g
from config import Config
from db import get_app_conn, put_app_conn
import services_cometchat as comet

bp = Blueprint("comet", __name__, url_prefix="/api/comet")

# Max CPs a single synchronous broadcast fans out to. Large sends should become
# a background job; kept modest for the synchronous request + Build rate limits.
_BROADCAST_MAX = 100

CHAT_NOT_ENABLED = "chat_not_enabled"


def _resolve_error_code(code):
    """Identity passthrough for the stable client-facing error codes (kept as a
    function so tests can assert the code exists without a request context)."""
    return code


def _cp_enabled(cur, cp_id) -> bool:
    cur.execute("SELECT enabled FROM cp_chat_access WHERE cp_id = %s", (cp_id,))
    row = cur.fetchone()
    return bool(row and row["enabled"])


def _cp_name_city(cp_id):
    """CP display name + city from channel_partners (name falls back to phone).
    Returns (None, None) when cp_id is missing / not found."""
    if not cp_id:
        return None, None
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT name, phone, city FROM channel_partners WHERE id = %s",
                (cp_id,),
            )
            cp = cur.fetchone()
    finally:
        put_app_conn(conn)
    if not cp:
        return None, None
    return (cp.get("name") or cp.get("phone")), cp.get("city")


@bp.post("/auth-token")
@require_auth
def auth_token():
    if not comet.configured():
        return jsonify({"error": "Chat is not configured."}), 503

    user = g.user
    uid = comet.cometchat_uid(user)
    if uid == Config.COMET_STAFF_UID:
        name, city = "Openhouse", None
    else:
        cp_id = user.get("cp_id")
        conn = get_app_conn()
        try:
            with conn.cursor() as cur:
                if not _cp_enabled(cur, cp_id):
                    cur.execute(
                        "SELECT 1 FROM chat_requests WHERE cp_id = %s AND resolved_at IS NULL LIMIT 1",
                        (cp_id,),
                    )
                    pending = cur.fetchone() is not None
                    return jsonify({"error": CHAT_NOT_ENABLED,
                                    "message": "Admin has not created chat account for you",
                                    "request_pending": pending}), 403
        finally:
            put_app_conn(conn)
        name, city = _cp_name_city(cp_id)
        name = name or user.get("phone") or uid
        if city is None:
            city = user.get("city")

    comet.ensure_user(uid, name, city)
    try:
        token = comet.issue_auth_token(uid)
    except Exception as e:  # noqa: BLE001 - surface as 502, chat is non-critical
        return jsonify({"error": f"Could not start chat: {e}"}), 502

    return jsonify({
        "uid": uid,
        "authToken": token,
        "appId": Config.COMET_APP_ID,
        "region": Config.COMET_REGION,
    }), 200


@bp.post("/ensure-user")
@require_auth
def ensure_user_route():
    """Staff-only: lazily provision a CP's CometChat user.

    CometChat users are normally created lazily when the CP themselves hits
    /comet/auth-token. That means staff opening a chat thread with a CP who
    has never logged into chat get a CometChat.getUser() rejection and the
    thread hangs. This lets staff provision that CP's CometChat user on
    demand before fetching it.
    """
    if g.user.get("role", "cp") == "cp":
        return jsonify({"error": "Forbidden"}), 403

    if not comet.configured():
        return jsonify({"error": "Chat is not configured."}), 503

    data = request.get_json(silent=True) or {}
    cp_id = data.get("cp_id")
    if not isinstance(cp_id, int):
        return jsonify({"error": "cp_id is required"}), 400

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, name, phone, city FROM channel_partners WHERE id = %s",
                (cp_id,),
            )
            cp = cur.fetchone()
    finally:
        put_app_conn(conn)

    if not cp:
        return jsonify({"error": "CP not found"}), 404

    uid = f"cp_{cp['id']}"
    name = cp.get("name") or cp.get("phone") or uid
    comet.ensure_user(uid, name, cp.get("city"))

    return jsonify({"ok": True, "uid": uid}), 200


@bp.post("/request-chat")
@require_auth
def request_chat():
    """CP asks an admin to enable their chat. Idempotent (one pending per CP)."""
    cp_id = g.user.get("cp_id")
    if g.user.get("role", "cp") != "cp" or not cp_id:
        return jsonify({"error": "Only CPs can request chat"}), 400
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            # Partial unique index (cp_id WHERE resolved_at IS NULL) makes a
            # duplicate pending request a no-op.
            cur.execute(
                "INSERT INTO chat_requests (cp_id) VALUES (%s) "
                "ON CONFLICT (cp_id) WHERE resolved_at IS NULL DO NOTHING",
                (cp_id,),
            )
            conn.commit()
    finally:
        put_app_conn(conn)
    return jsonify({"ok": True}), 200


@bp.post("/broadcast")
@require_auth
def broadcast():
    """ADMIN-ONLY. Fan a text message out from 'openhouse' to a set of CPs.

    Body: { "message": str, "cp_ids": [int]?, "city": str? }
      - cp_ids: explicit CP ids (takes precedence when a non-empty list).
      - city:   'All'/'*' for every active CP, else a city name.
    Each target is provisioned (ensure_user) then messaged. Capped at
    _BROADCAST_MAX per call (see note above). Returns a send summary.
    """
    if g.user.get("role", "cp") != "admin":
        return jsonify({"error": "Admin only"}), 403
    if not comet.configured():
        return jsonify({"error": "Chat is not configured."}), 503

    data = request.get_json(silent=True) or {}
    message = (data.get("message") or "").strip()
    if not message:
        return jsonify({"error": "message is required"}), 400
    cp_ids = data.get("cp_ids")
    city = (data.get("city") or "").strip()

    base_where = "cp.is_active = TRUE AND COALESCE(cp.is_admin, FALSE) = FALSE"
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            if isinstance(cp_ids, list) and cp_ids:
                cur.execute(
                    f"SELECT id, name, phone, city FROM channel_partners cp "
                    f"WHERE {base_where} AND cp.id = ANY(%s) LIMIT %s",
                    ([int(x) for x in cp_ids], _BROADCAST_MAX + 1),
                )
            elif city:
                if city in ("All", "*"):
                    cur.execute(
                        f"SELECT id, name, phone, city FROM channel_partners cp "
                        f"WHERE {base_where} LIMIT %s",
                        (_BROADCAST_MAX + 1,),
                    )
                else:
                    cur.execute(
                        f"SELECT id, name, phone, city FROM channel_partners cp "
                        f"WHERE {base_where} AND LOWER(TRIM(cp.city)) = LOWER(TRIM(%s)) LIMIT %s",
                        (city, _BROADCAST_MAX + 1),
                    )
            else:
                return jsonify({"error": "Provide cp_ids or a city"}), 400
            targets = cur.fetchall()
    finally:
        put_app_conn(conn)

    truncated = len(targets) > _BROADCAST_MAX
    targets = targets[:_BROADCAST_MAX]
    if not targets:
        return jsonify({"total": 0, "sent": 0, "failed": 0, "truncated": False}), 200

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            sent = 0
            for cp in targets:
                uid = f"cp_{cp['id']}"
                comet.ensure_user(uid, cp.get("name") or cp.get("phone") or uid, cp.get("city"))
                _set_access(cur, cp["id"], True, g.user.get("cp_id"))
                if comet.send_text_message(Config.COMET_STAFF_UID, uid, message):
                    sent += 1
            failed = len(targets) - sent
            log_activity(
                cur, action="admin_broadcast", category="chat",
                details={
                    "total": len(targets), "sent": sent, "failed": failed,
                    "city": city or None,
                    "cp_ids": cp_ids if isinstance(cp_ids, list) else None,
                    "preview": message[:200],
                },
            )
            conn.commit()
    finally:
        put_app_conn(conn)

    return jsonify({"total": len(targets), "sent": sent, "failed": failed, "truncated": truncated}), 200


def _require_admin():
    return g.user.get("role", "cp") == "admin"


def _set_access(cur, cp_id, enabled, actor_id):
    """Upsert cp_chat_access; stamp enabled_by/enabled_at or disabled_at."""
    if enabled:
        cur.execute(
            """
            INSERT INTO cp_chat_access (cp_id, enabled, enabled_by, enabled_at, updated_at)
            VALUES (%s, TRUE, %s, NOW(), NOW())
            ON CONFLICT (cp_id) DO UPDATE
                SET enabled = TRUE, enabled_by = EXCLUDED.enabled_by,
                    enabled_at = NOW(), updated_at = NOW()
            """,
            (cp_id, actor_id),
        )
    else:
        cur.execute(
            """
            INSERT INTO cp_chat_access (cp_id, enabled, disabled_at, updated_at)
            VALUES (%s, FALSE, NOW(), NOW())
            ON CONFLICT (cp_id) DO UPDATE
                SET enabled = FALSE, disabled_at = NOW(), updated_at = NOW()
            """,
            (cp_id,),
        )


@bp.get("/requests")
@require_auth
def list_requests():
    if not _require_admin():
        return jsonify({"error": "Admin only"}), 403
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT r.cp_id, r.requested_at, cp.name, cp.phone, cp.city
                FROM chat_requests r JOIN channel_partners cp ON cp.id = r.cp_id
                WHERE r.resolved_at IS NULL
                ORDER BY r.requested_at ASC LIMIT 200
                """
            )
            rows = cur.fetchall()
    finally:
        put_app_conn(conn)
    return jsonify({"requests": rows}), 200


@bp.get("/access")
@require_auth
def access_status():
    if not _require_admin():
        return jsonify({"error": "Admin only"}), 403
    raw = (request.args.get("cp_ids") or "").strip()
    ids = [int(x) for x in raw.split(",") if x.strip().isdigit()]
    if not ids:
        return jsonify({"enabled": []}), 200
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT cp_id FROM cp_chat_access WHERE enabled = TRUE AND cp_id = ANY(%s)",
                (ids,),
            )
            enabled = [r["cp_id"] for r in cur.fetchall()]
    finally:
        put_app_conn(conn)
    return jsonify({"enabled": enabled}), 200


@bp.post("/enable")
@require_auth
def enable_cp():
    if not _require_admin():
        return jsonify({"error": "Admin only"}), 403
    if not comet.configured():
        return jsonify({"error": "Chat is not configured."}), 503
    cp_id = (request.get_json(silent=True) or {}).get("cp_id")
    if not isinstance(cp_id, int):
        return jsonify({"error": "cp_id is required"}), 400
    name, city = _cp_name_city(cp_id)
    if not name:
        return jsonify({"error": "CP not found"}), 404
    comet.ensure_user(f"cp_{cp_id}", name, city)
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            _set_access(cur, cp_id, True, g.user.get("cp_id"))
            cur.execute(
                "UPDATE chat_requests SET resolved_at = NOW(), resolved_by = %s "
                "WHERE cp_id = %s AND resolved_at IS NULL",
                (g.user.get("cp_id"), cp_id),
            )
            log_activity(cur, action="chat_enable", category="chat",
                         entity_type="cp", entity_id=cp_id, details={"cp_id": cp_id})
            conn.commit()
    finally:
        put_app_conn(conn)
    return jsonify({"ok": True, "uid": f"cp_{cp_id}"}), 200


@bp.post("/disable")
@require_auth
def disable_cp():
    if not _require_admin():
        return jsonify({"error": "Admin only"}), 403
    cp_id = (request.get_json(silent=True) or {}).get("cp_id")
    if not isinstance(cp_id, int):
        return jsonify({"error": "cp_id is required"}), 400
    comet.revoke_auth_tokens(f"cp_{cp_id}")  # best-effort immediate cutoff
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            _set_access(cur, cp_id, False, g.user.get("cp_id"))
            log_activity(cur, action="chat_disable", category="chat",
                         entity_type="cp", entity_id=cp_id, details={"cp_id": cp_id})
            conn.commit()
    finally:
        put_app_conn(conn)
    return jsonify({"ok": True}), 200


def _resolve_send(user, cp_id_body):
    """Pure routing for /send: who is talking to whom, in which direction.

    Returns {from_uid, to_uid, direction, cp_id, is_cp}. Raises ValueError with a
    stable client-facing code ('not_cp' / 'cp_id_required'). Kept pure (no db, no
    flask.g) so it is unit-testable.
    """
    role = user.get("role", "cp")
    staff_uid = Config.COMET_STAFF_UID
    if role == "cp":
        cp_id = user.get("cp_id")
        if not cp_id:
            raise ValueError("not_cp")
        return {"from_uid": f"cp_{cp_id}", "to_uid": staff_uid,
                "direction": "inbound", "cp_id": cp_id, "is_cp": True}
    # staff (admin / manager / rm) -> a specific CP
    if not isinstance(cp_id_body, int):
        raise ValueError("cp_id_required")
    return {"from_uid": staff_uid, "to_uid": f"cp_{cp_id_body}",
            "direction": "outbound", "cp_id": cp_id_body, "is_cp": False}


def _staff_can_message(cur, user, cp_id):
    """Admin may message any CP; manager/rm only CPs in their own city (fail closed)."""
    if user.get("role") == "admin":
        return True
    city = (user.get("city") or "").strip()
    if not city:
        return False
    cur.execute("SELECT city FROM channel_partners WHERE id = %s", (cp_id,))
    row = cur.fetchone()
    return bool(row) and (row.get("city") or "").strip().lower() == city.lower()


@bp.post("/send")
@require_auth
def send_message():
    """Proxy a chat message through the backend so it's logged (with the real
    sender) in chat_messages, then relayed to CometChat.

    Both directions: staff->CP (outbound, attributed to the human behind the
    shared 'openhouse' identity) and CP->staff (inbound). We insert the row
    first, relay, then stamp the CometChat id — so a committed row always means
    a delivered message (relay failure rolls the row back).
    """
    if not comet.configured():
        return jsonify({"error": "Chat is not configured."}), 503
    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({"error": "text is required"}), 400
    text = text[:4000]  # ponytail: hard cap; well under CometChat's text limit

    try:
        route = _resolve_send(g.user, data.get("cp_id"))
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    cp_id = route["cp_id"]

    if route["is_cp"]:
        staff_id = staff_type = staff_phone = None
    else:
        staff_id, staff_type, staff_phone = _actor_from_g()

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            # Gate / scope before doing anything external.
            if route["is_cp"]:
                if not _cp_enabled(cur, cp_id):
                    return jsonify({"error": CHAT_NOT_ENABLED}), 403
            elif not _staff_can_message(cur, g.user, cp_id):
                return jsonify({"error": "out_of_scope"}), 403

            cur.execute(
                """
                INSERT INTO chat_messages
                    (direction, cp_id, sender_uid, staff_id, staff_type, staff_phone, body, sent_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
                RETURNING id
                """,
                (route["direction"], cp_id, route["from_uid"],
                 staff_id, staff_type, staff_phone, text),
            )
            row = cur.fetchone()

            msg_id = comet.send_text_message(route["from_uid"], route["to_uid"], text)
            if not msg_id:
                conn.rollback()
                return jsonify({"error": "Message could not be delivered"}), 502
            cur.execute(
                "UPDATE chat_messages SET comet_message_id = %s WHERE id = %s",
                (msg_id, row["id"]),
            )
            conn.commit()
    finally:
        put_app_conn(conn)

    return jsonify({"ok": True, "id": row["id"], "comet_message_id": msg_id,
                    "direction": route["direction"]}), 200


@bp.get("/history")
@require_auth
def history():
    """Attributed chat history for one CP, read ON DEMAND from chat_messages
    (NOT live — a single query per open, no per-message backend load). Staff
    only, scope-checked. Resolves each outbound message to the real human
    sender behind the shared 'openhouse' identity.
    """
    if g.user.get("role", "cp") == "cp":
        return jsonify({"error": "Forbidden"}), 403
    try:
        cp_id = int(request.args.get("cp_id") or "")
    except (TypeError, ValueError):
        return jsonify({"error": "cp_id is required"}), 400
    try:
        limit = min(max(int(request.args.get("limit") or 200), 1), 500)
    except (TypeError, ValueError):
        limit = 200

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            if not _staff_can_message(cur, g.user, cp_id):
                return jsonify({"error": "out_of_scope"}), 403
            # staff_id namespaces differ by staff_type: admin -> channel_partners,
            # manager/rm -> rms. Resolve the display name from the right table.
            cur.execute(
                """
                SELECT m.id, m.direction, m.body, m.sent_at, m.staff_type, m.staff_phone,
                       cp.name AS cp_name,
                       CASE WHEN m.staff_type = 'admin' THEN a.name
                            WHEN m.staff_type IN ('manager','rm') THEN r.name END AS staff_name
                FROM chat_messages m
                LEFT JOIN channel_partners cp ON cp.id = m.cp_id
                LEFT JOIN channel_partners a  ON m.staff_type = 'admin' AND a.id = m.staff_id
                LEFT JOIN rms r               ON m.staff_type IN ('manager','rm') AND r.id = m.staff_id
                WHERE m.cp_id = %s
                ORDER BY m.id ASC
                LIMIT %s
                """,
                (cp_id, limit),
            )
            rows = cur.fetchall()
    finally:
        put_app_conn(conn)

    messages = []
    for m in rows:
        if m["direction"] == "outbound":
            label = m["staff_name"] or m["staff_phone"] or "Staff"
            if m["staff_type"]:
                label = f"{label} ({m['staff_type']})"
        else:
            label = m["cp_name"] or "CP"
        messages.append({
            "id": m["id"], "direction": m["direction"], "body": m["body"],
            "sent_at": m["sent_at"], "sender": label,
        })
    return jsonify({"messages": messages}), 200
