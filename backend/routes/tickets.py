"""CP Inventory Portal — Tickets (ported/adapted from Direct_Inventory).

Staff (admin/manager) raise an issue on a submission or directly to an RM; the
assigned RM replies; back-and-forth until the creator/admin closes it.

CP adaptations vs Direct_Inventory:
  - Split staff identity: admins live in channel_partners (JWT cp_id), managers
    in rms (JWT rm_id). A ticket stores (created_by_source, created_by_id) and
    all identity comparisons use the (source, id) PAIR — ids from the two
    tables can collide.
  - No `inventory` table: a ticket links to a `submissions` row; the assigned RM
    is the submission's effective RM = COALESCE(listing_rm_id, cp.rm_id).
  - Manager "team" = the recursive rms.manager_id subtree (same CTE the board
    scoping uses).
  - Staff use name + phone (email is optional on rms).

Auth: every route is @require_staff + @require_acting_staff → admin/manager/rm
only (viewer and cp are rejected from tickets entirely).
"""
from __future__ import annotations

import json
import uuid as _uuid
from datetime import datetime, timezone

from flask import Blueprint, g, jsonify, request

from activity_log import log_activity
from auth import require_acting_staff, require_staff
from db import get_app_conn, put_app_conn

bp = Blueprint("tickets", __name__, url_prefix="/api/tickets")

# me + every RM transitively beneath me via rms.manager_id (UNION guards cycles).
# One %s = the root rm_id.
_TEAM_RM_IDS_SQL = (
    "(WITH RECURSIVE my_team(id) AS ("
    " SELECT id FROM rms WHERE id = %s"
    " UNION"
    " SELECT r.id FROM rms r JOIN my_team t ON r.manager_id = t.id"
    ") SELECT id FROM my_team)"
)

_SELECT = """
  SELECT t.id, t.submission_id, t.public_id, t.title, t.summary, t.status, t.awaiting,
         t.created_by_source, t.created_by_id, t.created_by_name, t.created_by_phone,
         t.assigned_rm_id, t.city_id, t.messages,
         t.last_activity_at, t.created_at, t.closed_at, t.closed_by_source, t.closed_by_id,
         s.society_name AS society_name,
         r.name AS assigned_rm_name, r.phone AS assigned_rm_phone, r.email AS assigned_rm_email
  FROM tickets t
  LEFT JOIN submissions s ON s.id = t.submission_id
  LEFT JOIN rms r ON r.id = t.assigned_rm_id
"""

_LIST_SELECT = """
  SELECT t.id, t.submission_id, t.public_id, t.title, t.summary, t.status, t.awaiting,
         t.created_by_source, t.created_by_id, t.created_by_name, t.created_by_phone,
         t.assigned_rm_id, t.city_id,
         CASE WHEN jsonb_typeof(t.messages) = 'array'
              THEN jsonb_array_length(t.messages) ELSE 0 END AS message_count,
         t.last_activity_at, t.created_at, t.closed_at,
         s.society_name AS society_name,
         r.name AS assigned_rm_name, r.phone AS assigned_rm_phone
  FROM tickets t
  LEFT JOIN submissions s ON s.id = t.submission_id
  LEFT JOIN rms r ON r.id = t.assigned_rm_id
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _actor(user: dict):
    """(source, id, phone) for the caller. admin -> ('cp', cp_id); manager/rm -> ('rm', rm_id)."""
    if user.get("role") == "admin":
        return "cp", user.get("cp_id"), user.get("phone")
    return "rm", user.get("rm_id"), user.get("phone")


def _visibility(user: dict):
    role = user.get("role")
    if role == "admin":
        return "TRUE", []
    _, uid, _ = _actor(user)
    if role == "manager":
        return (f"t.assigned_rm_id IN {_TEAM_RM_IDS_SQL}", [uid])
    return ("t.assigned_rm_id = %s", [uid])  # rm


def _action_clause(user: dict):
    role = user.get("role")
    source, uid, _ = _actor(user)
    if role == "rm":
        return ("t.status = 'open' AND t.assigned_rm_id = %s AND t.awaiting = 'rm'", [uid])
    return (
        "t.status = 'open' AND t.created_by_source = %s AND t.created_by_id = %s "
        "AND t.awaiting = 'creator'",
        [source, uid],
    )


def _pending_count(cur, user: dict) -> int:
    clause, params = _action_clause(user)
    cur.execute(f"SELECT COUNT(*) AS n FROM tickets t WHERE {clause}", params)
    return cur.fetchone()["n"]


def _is_creator(user: dict, ticket: dict) -> bool:
    source, uid, _ = _actor(user)
    return ticket["created_by_source"] == source and ticket["created_by_id"] == uid


def _can_reply(user: dict, ticket: dict) -> bool:
    if user.get("role") == "admin" or _is_creator(user, ticket):
        return True
    _, uid, _ = _actor(user)
    return user.get("role") == "rm" and uid == ticket["assigned_rm_id"]


def _can_close(user: dict, ticket: dict) -> bool:
    return user.get("role") == "admin" or _is_creator(user, ticket)


def _fetch_one(cur, ticket_id: int):
    cur.execute(_SELECT + " WHERE t.id = %s", (ticket_id,))
    return cur.fetchone()


@bp.get("")
@require_staff
@require_acting_staff
def list_tickets():
    vis, params = _visibility(g.user)
    where = [vis]
    submission_id = request.args.get("submission_id")
    if submission_id:
        where.append("t.submission_id = %s")
        params.append(int(submission_id))
    status = request.args.get("status")
    if status in ("open", "closed"):
        where.append("t.status = %s")
        params.append(status)
    if request.args.get("scope") == "action":
        clause, aparams = _action_clause(g.user)
        where.append(clause)
        params.extend(aparams)
    limit = max(1, min(request.args.get("limit", default=50, type=int) or 50, 500))
    offset = max(0, request.args.get("offset", default=0, type=int) or 0)
    where_sql = " WHERE " + " AND ".join(where)
    conn = get_app_conn()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) AS n FROM tickets t" + where_sql, params)
                total = cur.fetchone()["n"]
                cur.execute(
                    _LIST_SELECT + where_sql
                    + " ORDER BY t.last_activity_at DESC LIMIT %s OFFSET %s",
                    [*params, limit, offset],
                )
                items = cur.fetchall()
        return jsonify({"items": items, "total": total})
    finally:
        put_app_conn(conn)


@bp.get("/pending-count")
@require_staff
@require_acting_staff
def pending_count_route():
    conn = get_app_conn()
    try:
        with conn:
            with conn.cursor() as cur:
                return jsonify({"count": _pending_count(cur, g.user)})
    finally:
        put_app_conn(conn)


@bp.get("/<int:ticket_id>")
@require_staff
@require_acting_staff
def get_ticket(ticket_id: int):
    conn = get_app_conn()
    try:
        with conn:
            with conn.cursor() as cur:
                t = _fetch_one(cur, ticket_id)
                if not t:
                    return jsonify({"error": "not found"}), 404
                vis, params = _visibility(g.user)
                cur.execute(
                    f"SELECT 1 FROM tickets t WHERE t.id = %s AND {vis}", [ticket_id, *params]
                )
                if not cur.fetchone():
                    return jsonify({"error": "not found"}), 404
                return jsonify(t)
    finally:
        put_app_conn(conn)


@bp.post("")
@require_staff
@require_acting_staff
def create_ticket():
    if g.user.get("role") not in ("admin", "manager"):
        return jsonify({"error": "Only admins and managers can create tickets"}), 403
    body = request.get_json(silent=True) or {}
    title = (body.get("title") or "").strip()
    summary = (body.get("summary") or "").strip()
    submission_id = body.get("submission_id")
    rm_id = body.get("rm_id") or body.get("assigned_rm_id")
    if not title:
        return jsonify({"error": "title is required"}), 400
    if not submission_id and not rm_id:
        return jsonify({"error": "a submission_id or an rm_id is required"}), 400

    source, uid, phone = _actor(g.user)
    conn = get_app_conn()
    try:
        with conn:
            with conn.cursor() as cur:
                public_id = None
                city_id = None
                if submission_id:
                    cur.execute(
                        "SELECT s.id, s.public_id, s.city_id, "
                        "COALESCE(s.listing_rm_id, cp.rm_id) AS effective_rm_id "
                        "FROM submissions s JOIN channel_partners cp ON cp.id = s.cp_id "
                        "WHERE s.id = %s",
                        (int(submission_id),),
                    )
                    sub = cur.fetchone()
                    if not sub:
                        return jsonify({"error": "submission not found"}), 404
                    assigned_rm_id = sub["effective_rm_id"]
                    if not assigned_rm_id:
                        return jsonify({"error": "submission has no assigned RM"}), 400
                    public_id = sub["public_id"]
                    city_id = sub["city_id"]
                else:
                    assigned_rm_id = int(rm_id)
                    cur.execute(
                        "SELECT id FROM rms WHERE id = %s "
                        "AND COALESCE(is_manager, FALSE) = FALSE "
                        "AND COALESCE(is_viewer, FALSE) = FALSE",
                        (assigned_rm_id,),
                    )
                    if not cur.fetchone():
                        return jsonify({"error": "invalid RM"}), 400

                if g.user.get("role") == "manager":
                    cur.execute(f"SELECT 1 WHERE %s IN {_TEAM_RM_IDS_SQL}", (assigned_rm_id, uid))
                    if not cur.fetchone():
                        return jsonify({"error": "that RM is not in your team"}), 403

                if source == "cp":
                    cur.execute("SELECT name, phone FROM channel_partners WHERE id = %s", (uid,))
                else:
                    cur.execute("SELECT name, phone FROM rms WHERE id = %s", (uid,))
                me = cur.fetchone() or {}

                cur.execute(
                    """
                    INSERT INTO tickets
                      (submission_id, public_id, title, summary, status, awaiting,
                       created_by_source, created_by_id, created_by_name, created_by_phone,
                       assigned_rm_id, city_id, messages, last_activity_at)
                    VALUES (%s, %s, %s, %s, 'open', 'rm', %s, %s, %s, %s, %s, %s, '[]'::jsonb, NOW())
                    RETURNING id
                    """,
                    (int(submission_id) if submission_id else None, public_id, title,
                     summary or None, source, uid, me.get("name"), me.get("phone") or phone,
                     assigned_rm_id, city_id),
                )
                ticket_id = cur.fetchone()["id"]
                if submission_id:
                    log_activity(
                        cur, action="ticket_created", category="ticket",
                        entity_uid=public_id, entity_type="ticket", entity_id=ticket_id,
                        details={"title": title, "assigned_rm_id": assigned_rm_id,
                                 "submission_id": int(submission_id)},
                    )
                ticket = _fetch_one(cur, ticket_id)
        return jsonify(ticket), 201
    finally:
        put_app_conn(conn)


@bp.post("/<int:ticket_id>/reply")
@require_staff
@require_acting_staff
def reply(ticket_id: int):
    text = ((request.get_json(silent=True) or {}).get("body") or "").strip()
    if not text:
        return jsonify({"error": "body is required"}), 400
    source, uid, phone = _actor(g.user)
    conn = get_app_conn()
    try:
        with conn:
            with conn.cursor() as cur:
                t = _fetch_one(cur, ticket_id)
                if not t:
                    return jsonify({"error": "not found"}), 404
                if not _can_reply(g.user, t):
                    return jsonify({"error": "forbidden"}), 403
                if t["status"] != "open":
                    return jsonify({"error": "ticket is closed"}), 409
                # Resolve the REPLIER's own name (JWT lacks it). Correct for
                # every replier — creator, assigned RM, or an admin who isn't
                # the creator (guessing from the ticket would misattribute this).
                if source == "cp":
                    cur.execute("SELECT name, phone FROM channel_partners WHERE id = %s", (uid,))
                else:
                    cur.execute("SELECT name, phone FROM rms WHERE id = %s", (uid,))
                me = cur.fetchone() or {}
                msg = {
                    "id": str(_uuid.uuid4()),
                    "author_source": source,
                    "author_id": uid,
                    "author_name": me.get("name"),
                    "author_phone": me.get("phone") or phone,
                    "author_role": g.user.get("role"),
                    "body": text,
                    "created_at": _now(),
                }
                awaiting = "creator" if g.user.get("role") == "rm" else "rm"
                cur.execute(
                    "UPDATE tickets SET messages = COALESCE(messages, '[]'::jsonb) || %s::jsonb, "
                    "awaiting = %s, last_activity_at = NOW() WHERE id = %s",
                    (json.dumps([msg]), awaiting, ticket_id),
                )
                log_activity(
                    cur, action="ticket_reply", category="ticket",
                    entity_uid=t["public_id"], entity_type="ticket", entity_id=ticket_id,
                    details={"ticket_id": ticket_id, "body": text},
                )
                ticket = _fetch_one(cur, ticket_id)
        return jsonify(ticket)
    finally:
        put_app_conn(conn)


@bp.post("/<int:ticket_id>/close")
@require_staff
@require_acting_staff
def close_ticket(ticket_id: int):
    source, uid, _ = _actor(g.user)
    conn = get_app_conn()
    try:
        with conn:
            with conn.cursor() as cur:
                t = _fetch_one(cur, ticket_id)
                if not t:
                    return jsonify({"error": "not found"}), 404
                if not _can_close(g.user, t):
                    return jsonify({"error": "forbidden"}), 403
                cur.execute(
                    "UPDATE tickets SET status = 'closed', awaiting = NULL, closed_at = NOW(), "
                    "closed_by_source = %s, closed_by_id = %s, last_activity_at = NOW() WHERE id = %s",
                    (source, uid, ticket_id),
                )
                log_activity(
                    cur, action="ticket_closed", category="ticket",
                    entity_uid=t["public_id"], entity_type="ticket", entity_id=ticket_id,
                    details={"ticket_id": ticket_id},
                )
                ticket = _fetch_one(cur, ticket_id)
        return jsonify(ticket)
    finally:
        put_app_conn(conn)


@bp.post("/<int:ticket_id>/reopen")
@require_staff
@require_acting_staff
def reopen_ticket(ticket_id: int):
    conn = get_app_conn()
    try:
        with conn:
            with conn.cursor() as cur:
                t = _fetch_one(cur, ticket_id)
                if not t:
                    return jsonify({"error": "not found"}), 404
                if not _can_close(g.user, t):     # same authority as closing
                    return jsonify({"error": "forbidden"}), 403
                cur.execute(
                    "UPDATE tickets SET status = 'open', awaiting = 'rm', closed_at = NULL, "
                    "closed_by_source = NULL, closed_by_id = NULL, last_activity_at = NOW() "
                    "WHERE id = %s",
                    (ticket_id,),
                )
                ticket = _fetch_one(cur, ticket_id)
        return jsonify(ticket)
    finally:
        put_app_conn(conn)
