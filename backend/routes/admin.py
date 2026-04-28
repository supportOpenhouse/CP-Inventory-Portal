"""Admin + RM endpoints under /api/admin/*.

Access: require_staff (role = 'rm' or 'admin').
Scope: admin sees all cities, RM sees only their own.

Endpoints:
  GET    /api/admin/submissions                 — list with filters
  GET    /api/admin/submissions/<id>            — one submission + events
  POST   /api/admin/submissions/<id>/status     — change status (rm+admin)
  POST   /api/admin/submissions/<id>/comment    — add comment (rm+admin)
  PATCH  /api/admin/submissions/<id>            — edit fields (ADMIN ONLY)
  DELETE /api/admin/submissions/<id>            — soft delete (ADMIN ONLY)
  GET    /api/admin/submissions.csv             — export filtered results
  GET    /api/admin/cp/<cp_id>/submissions      — CP history
"""

import csv
import io
import json
import logging
import re
from datetime import datetime
from functools import wraps

import requests
from flask import Blueprint, Response, g, jsonify, request

from auth import require_staff
from config import Config
from db import get_app_conn, put_app_conn, get_props_conn, put_props_conn, properties_configured
from utils import to_int, to_str

log = logging.getLogger(__name__)

bp = Blueprint("admin", __name__, url_prefix="/api/admin")

VALID_STAGES = ["Unapproved", "Submitted", "Evaluation", "Offer Given", "Visit Scheduled", "Closed", "Rejected"]


def require_admin_role(f):
    """Admin only. Use AFTER require_staff."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        if g.user.get("role") != "admin":
            return jsonify({"error": "Admin only"}), 403
        return f(*args, **kwargs)
    return wrapper


# ---- helpers ----

def _scoped_city_filter(cur):
    """
    Scope filter applied to submissions list/count/detail queries.

    IMPORTANT: returns SQL that references `s.cp_id` and uses a subquery
    against channel_partners, so it works for queries that don't join
    `channel_partners cp` directly. The `s` alias on submissions is assumed.

    Admin (role='admin'): no restriction.

    RM from rms table (rm_id in JWT):
      - Non-manager : s.cp_id IN (CPs where cp.rm_id = me)
      - Manager     : s.cp_id IN (CPs where cp.rm_id = me
                                  OR cp.rm_id IN my team)
      Unapproved is hidden either way.

    RM from channel_partners (legacy, cp_id in JWT with role='rm'):
      Same as before (city_id OR assigned_rm_id).
    """
    role = g.user.get("role", "cp")
    if role == "admin":
        return "", []

    rm_id = g.user.get("rm_id")              # new: RM from rms table
    is_manager = bool(g.user.get("is_manager"))
    cp_id_legacy = g.user.get("cp_id")       # legacy RM in channel_partners
    city_id_legacy = g.user.get("city_id") if not rm_id else None

    if rm_id:
        # Subquery avoids needing a `cp` join alias in the outer query.
        if is_manager:
            clause = (
                "s.cp_id IN ("
                "  SELECT id FROM channel_partners "
                "  WHERE rm_id = %s "
                "     OR rm_id IN (SELECT id FROM rms WHERE manager_id = %s)"
                ")"
            )
            params = [rm_id, rm_id]
        else:
            clause = (
                "s.cp_id IN (SELECT id FROM channel_partners WHERE rm_id = %s)"
            )
            params = [rm_id]
        # Staff see all stages including Unapproved (full visibility into their CPs' funnel).
        return f"AND {clause}", params

    # Legacy path — RM was a channel_partners row with role='rm'
    if city_id_legacy or cp_id_legacy:
        clauses = []
        params = []
        if city_id_legacy:
            clauses.append("s.city_id = %s")
            params.append(city_id_legacy)
        if cp_id_legacy:
            clauses.append("s.assigned_rm_id = %s")
            params.append(cp_id_legacy)
        where = " OR ".join(clauses)
        return f"AND ({where})", params

    # No scope info at all — deny by default
    return "AND FALSE", []


def _apply_filters(base_sql: str, params: list):
    """Append filters from query string to base SQL."""
    status = to_str(request.args.get("status"))
    city = to_str(request.args.get("city"))
    search = to_str(request.args.get("search"))
    since_days = request.args.get("since_days", type=int)
    cp_id = request.args.get("cp_id", type=int)
    bhk = to_str(request.args.get("bhk"))
    date_from = to_str(request.args.get("date_from"))
    date_to = to_str(request.args.get("date_to"))

    # Filtering rules for soft-deleted (deleted_at IS NOT NULL):
    #   - CP-withdrawn submissions (withdraw_reason='cp_withdrawn'): SHOWN by default
    #     so admin can see withdrawn cards in Unapproved column with the proper indicators.
    #   - Admin-deleted submissions (withdraw_reason IS NULL or 'admin_deleted'):
    #     HIDDEN by default — these are intentional deletes by staff.
    #   - include_deleted=true overrides both — shows everything.
    include_deleted = request.args.get("include_deleted", "false").lower() == "true"

    if not include_deleted:
        base_sql += (
            " AND (s.deleted_at IS NULL "
            "      OR s.withdraw_reason = 'cp_withdrawn')"
        )

    if status and status in VALID_STAGES:
        base_sql += " AND s.status = %s"
        params.append(status)

    if city:
        base_sql += " AND c.name = %s"
        params.append(city)

    if search:
        base_sql += """ AND (
            s.society_name ILIKE %s OR cp.cp_code ILIKE %s
            OR cp.name ILIKE %s OR s.unit_no ILIKE %s
            OR s.seller_name ILIKE %s
        )"""
        like = f"%{search}%"
        params.extend([like, like, like, like, like])

    if since_days and since_days > 0:
        base_sql += " AND s.submitted_at > NOW() - (%s || ' days')::interval"
        params.append(str(since_days))

    if cp_id:
        base_sql += " AND s.cp_id = %s"
        params.append(cp_id)

    if bhk:
        base_sql += " AND s.bhk = %s"
        params.append(bhk)

    if date_from:
        base_sql += " AND s.submitted_at >= %s"
        params.append(date_from)

    if date_to:
        base_sql += " AND s.submitted_at < (%s::date + interval '1 day')"
        params.append(date_to)

    return base_sql, params


def _list_submissions_core():
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            scope_sql, scope_params = _scoped_city_filter(cur)
            base_sql = f"""
                SELECT
                    s.id, s.public_id, s.society_name, s.tower, s.unit_no, s.floor,
                    s.sqft, s.bhk, s.furnishing, s.occupancy_status,
                    s.parking, s.exit_facing, s.balcony_facing, s.balcony_view,
                    s.asking_price,
                    s.seller_name, s.seller_phone,
                    s.status, s.submitted_at, s.photos, s.weak_match, s.collated_match,
                    s.deleted_at, s.drive_links, s.assigned_rm_id,
                    s.unit_less, s.perfect_match_at_submit, s.withdraw_reason,
                    s.forms_uid, s.scheduled_date, s.scheduled_time, s.field_exec_name,
                    c.name AS city,
                    cp.id AS cp_id,
                    cp.cp_code, cp.name AS cp_name, cp.phone AS cp_phone,
                    cp.company AS cp_company,
                    rm.name AS assigned_rm_name,
                    acq.acq_price_lakhs, acq.acq_sqft
                FROM submissions s
                LEFT JOIN cities c ON s.city_id = c.id
                JOIN channel_partners cp ON s.cp_id = cp.id
                LEFT JOIN channel_partners rm ON s.assigned_rm_id = rm.id
                LEFT JOIN LATERAL (
                    -- Match: same society (case/whitespace-insensitive), same city, same bhk
                    -- (strict). Tie-break by closest sqft to the submission. Returns 1 row.
                    SELECT ap.acq_price_lakhs, ap.sqft AS acq_sqft
                    FROM acquisition_prices ap
                    WHERE LOWER(REGEXP_REPLACE(ap.society_name, '[^a-zA-Z0-9]', '', 'g'))
                          = LOWER(REGEXP_REPLACE(COALESCE(s.society_name, ''), '[^a-zA-Z0-9]', '', 'g'))
                      AND LOWER(TRIM(ap.city)) = LOWER(TRIM(c.name))
                      -- BHK normalized to digits only ('3 BHK', '3BHK', '3' all become '3')
                      AND REGEXP_REPLACE(COALESCE(ap.bhk, ''), '[^0-9.]', '', 'g')
                          = REGEXP_REPLACE(COALESCE(s.bhk, ''), '[^0-9.]', '', 'g')
                    ORDER BY ABS(COALESCE(ap.sqft, 0) - COALESCE(s.sqft, 0)) ASC
                    LIMIT 1
                ) acq ON TRUE
                WHERE TRUE {scope_sql}
            """
            params = list(scope_params)
            sql, params = _apply_filters(base_sql, params)
            sql += " ORDER BY s.submitted_at DESC LIMIT 5000"
            cur.execute(sql, params)
            return cur.fetchall()
    finally:
        put_app_conn(conn)


def _stage_counts():
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            scope_sql, scope_params = _scoped_city_filter(cur)
            base_sql = f"""
                SELECT s.status, COUNT(*) AS cnt
                FROM submissions s
                LEFT JOIN cities c ON s.city_id = c.id
                JOIN channel_partners cp ON s.cp_id = cp.id
                WHERE TRUE {scope_sql} AND (s.deleted_at IS NULL OR s.withdraw_reason = 'cp_withdrawn')
            """
            params = list(scope_params)

            city = to_str(request.args.get("city"))
            search = to_str(request.args.get("search"))
            since_days = request.args.get("since_days", type=int)
            cp_id = request.args.get("cp_id", type=int)
            bhk = to_str(request.args.get("bhk"))
            date_from = to_str(request.args.get("date_from"))
            date_to = to_str(request.args.get("date_to"))

            if city:
                base_sql += " AND c.name = %s"
                params.append(city)
            if search:
                base_sql += """ AND (
                    s.society_name ILIKE %s OR cp.cp_code ILIKE %s
                    OR cp.name ILIKE %s OR s.unit_no ILIKE %s
                    OR s.seller_name ILIKE %s
                )"""
                like = f"%{search}%"
                params.extend([like, like, like, like, like])
            if since_days and since_days > 0:
                base_sql += " AND s.submitted_at > NOW() - (%s || ' days')::interval"
                params.append(str(since_days))
            if cp_id:
                base_sql += " AND s.cp_id = %s"
                params.append(cp_id)
            if bhk:
                base_sql += " AND s.bhk = %s"
                params.append(bhk)
            if date_from:
                base_sql += " AND s.submitted_at >= %s"
                params.append(date_from)
            if date_to:
                base_sql += " AND s.submitted_at < (%s::date + interval '1 day')"
                params.append(date_to)

            base_sql += " GROUP BY s.status"
            cur.execute(base_sql, params)
            rows = cur.fetchall()
            counts = {s: 0 for s in VALID_STAGES}
            for r in rows:
                if r["status"] in counts:
                    counts[r["status"]] = r["cnt"]
            counts["Total"] = sum(counts.values())
            return counts
    finally:
        put_app_conn(conn)


# ---- endpoints ----

@bp.get("/submissions")
@require_staff
def list_submissions():
    subs = _list_submissions_core()
    counts = _stage_counts()
    return jsonify({"submissions": subs, "counts": counts}), 200


@bp.get("/submissions/<int:sid>")
@require_staff
def get_submission(sid: int):
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            scope_sql, scope_params = _scoped_city_filter(cur)
            cur.execute(f"""
                SELECT s.*, c.name AS city,
                       cp.id AS cp_id, cp.cp_code, cp.name AS cp_name,
                       cp.phone AS cp_phone, cp.company AS cp_company,
                       cp.rm_id AS cp_rm_id,
                       cp_rm.name AS cp_rm_name,
                       rm.name AS assigned_rm_name,
                       acq.acq_price_lakhs, acq.acq_sqft
                FROM submissions s
                LEFT JOIN cities c ON s.city_id = c.id
                JOIN channel_partners cp ON s.cp_id = cp.id
                LEFT JOIN rms cp_rm ON cp.rm_id = cp_rm.id
                LEFT JOIN channel_partners rm ON s.assigned_rm_id = rm.id
                LEFT JOIN LATERAL (
                    SELECT ap.acq_price_lakhs, ap.sqft AS acq_sqft
                    FROM acquisition_prices ap
                    WHERE LOWER(REGEXP_REPLACE(ap.society_name, '[^a-zA-Z0-9]', '', 'g'))
                          = LOWER(REGEXP_REPLACE(COALESCE(s.society_name, ''), '[^a-zA-Z0-9]', '', 'g'))
                      AND LOWER(TRIM(ap.city)) = LOWER(TRIM(c.name))
                      -- BHK normalized to digits only ('3 BHK', '3BHK', '3' all become '3')
                      AND REGEXP_REPLACE(COALESCE(ap.bhk, ''), '[^0-9.]', '', 'g')
                          = REGEXP_REPLACE(COALESCE(s.bhk, ''), '[^0-9.]', '', 'g')
                    ORDER BY ABS(COALESCE(ap.sqft, 0) - COALESCE(s.sqft, 0)) ASC
                    LIMIT 1
                ) acq ON TRUE
                WHERE s.id = %s {scope_sql}
            """, [sid, *scope_params])
            submission = cur.fetchone()
            if not submission:
                return jsonify({"error": "Not found or out of scope"}), 404

            cur.execute("""
                SELECT e.id, e.kind, e.from_status, e.to_status, e.text, e.created_at,
                       cp.name AS actor_name, cp.cp_code AS actor_cp_code, cp.role AS actor_role
                FROM submission_events e
                LEFT JOIN channel_partners cp ON e.actor_cp_id = cp.id
                WHERE e.submission_id = %s
                ORDER BY e.created_at ASC, e.id ASC
            """, (sid,))
            events = cur.fetchall()
    finally:
        put_app_conn(conn)

    return jsonify({"submission": submission, "events": events}), 200


@bp.post("/submissions/<int:sid>/status")
@require_staff
def change_status(sid: int):
    data = request.get_json(silent=True) or {}
    new_status = to_str(data.get("status"))
    if not new_status or new_status not in VALID_STAGES:
        return jsonify({"error": f"Invalid status. Must be one of: {VALID_STAGES}"}), 400

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            scope_sql, scope_params = _scoped_city_filter(cur)
            cur.execute(f"""
                SELECT s.id, s.status FROM submissions s
                LEFT JOIN cities c ON s.city_id = c.id
                WHERE s.id = %s AND s.deleted_at IS NULL {scope_sql}
                FOR UPDATE OF s
            """, [sid, *scope_params])
            existing = cur.fetchone()
            if not existing:
                return jsonify({"error": "Not found or out of scope"}), 404

            old_status = existing["status"]
            if old_status == new_status:
                return jsonify({"ok": True, "unchanged": True}), 200

            cur.execute("UPDATE submissions SET status = %s WHERE id = %s", (new_status, sid))
            cur.execute("""
                INSERT INTO submission_events
                    (submission_id, actor_cp_id, kind, from_status, to_status)
                VALUES (%s, %s, 'status_change', %s, %s)
            """, (sid, g.user["cp_id"], old_status, new_status))
            conn.commit()
    finally:
        put_app_conn(conn)
    return jsonify({"ok": True, "from": old_status, "to": new_status}), 200


@bp.post("/submissions/<int:sid>/counter-offer")
@require_staff
def send_counter_offer(sid: int):
    """Admin sends a counter offer. Submission stays in 'Evaluation'.

    Payload: { "price_rupees": 9500000 }  (integer, in rupees)
    OR       { "price_lakhs":  95 }        (integer, in lakhs — converted server-side)

    Stage does NOT change here — stays 'Evaluation'. CP responds via
    /api/submissions/<id>/counter-offer-response, which moves to
    'Offer Given' (accept) or 'Rejected' (reject).
    """
    data = request.get_json(silent=True) or {}
    price_rupees = data.get("price_rupees")
    price_lakhs = data.get("price_lakhs")

    # Accept either format
    if price_rupees is None and price_lakhs is not None:
        try:
            price_rupees = int(float(price_lakhs) * 100000)
        except (ValueError, TypeError):
            return jsonify({"error": "Invalid price_lakhs"}), 400

    try:
        price_rupees = int(price_rupees)
    except (ValueError, TypeError):
        return jsonify({"error": "price_rupees (or price_lakhs) is required"}), 400

    if price_rupees <= 0:
        return jsonify({"error": "Counter offer price must be > 0"}), 400

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, status, counter_offer_status
                FROM submissions
                WHERE id = %s
                FOR UPDATE
                """,
                (sid,),
            )
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Submission not found"}), 404
            if row["status"] != "Evaluation":
                return jsonify({
                    "error": "Counter offer only allowed when status is 'Evaluation'",
                    "current_status": row["status"],
                }), 409

            cur.execute(
                """
                UPDATE submissions
                SET counter_offer_price  = %s,
                    counter_offer_status = 'pending',
                    counter_offer_at     = NOW(),
                    counter_offer_by     = %s
                WHERE id = %s
                """,
                (price_rupees, g.user["cp_id"], sid),
            )
            cur.execute(
                """
                INSERT INTO submission_events
                    (submission_id, actor_cp_id, kind, text)
                VALUES (%s, %s, 'counter_offer', %s)
                """,
                (sid, g.user["cp_id"], f"Counter offer sent: ₹{price_rupees:,}"),
            )
            conn.commit()
    finally:
        put_app_conn(conn)

    return jsonify({"ok": True, "counter_offer_price": price_rupees}), 200


@bp.post("/submissions/<int:sid>/comment")
@require_staff
def add_comment(sid: int):
    data = request.get_json(silent=True) or {}
    text = to_str(data.get("text"))
    if not text or len(text.strip()) == 0:
        return jsonify({"error": "Comment text required"}), 400
    if len(text) > 2000:
        return jsonify({"error": "Comment too long"}), 400

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            scope_sql, scope_params = _scoped_city_filter(cur)
            cur.execute(f"""
                SELECT s.id FROM submissions s
                LEFT JOIN cities c ON s.city_id = c.id
                WHERE s.id = %s
                  AND (s.deleted_at IS NULL OR s.withdraw_reason = 'cp_withdrawn')
                  {scope_sql}
            """, [sid, *scope_params])
            if not cur.fetchone():
                return jsonify({"error": "Not found or out of scope"}), 404

            cur.execute("""
                INSERT INTO submission_events (submission_id, actor_cp_id, kind, text)
                VALUES (%s, %s, 'comment', %s)
                RETURNING id, created_at
            """, (sid, g.user["cp_id"], text.strip()))
            row = cur.fetchone()
            conn.commit()
    finally:
        put_app_conn(conn)
    return jsonify({"ok": True, "event_id": row["id"], "created_at": row["created_at"]}), 201


# ---- ADMIN-ONLY: edit ----

# field_name -> (type, max_len or None)
EDITABLE_FIELDS = {
    "tower":               ("str", 50),
    "unit_no":             ("str", 50),
    "floor":               ("str", 50),
    "sqft":                ("int", None),
    "bhk":                 ("str", 20),
    "furnishing":          ("str", 50),
    "exit_facing":         ("str", 50),
    "balcony_facing":      ("str", 50),
    "balcony_view":        ("str", 100),
    "parking":             ("str", 50),
    "occupancy_status":    ("str", 20),
    "asking_price":        ("int", None),
    "seller_name":         ("str", 200),
    "seller_phone":        ("str", 20),
    "extra_rooms":         ("json", None),
    "additional_comments": ("text", None),
    "drive_links":         ("text", None),
    "photos":              ("json", None),
    "assigned_rm_id":      ("int", None),   # null = unassigned; city-default applies
}


@bp.patch("/submissions/<int:sid>")
@require_staff
@require_admin_role
def edit_submission(sid: int):
    data = request.get_json(silent=True) or {}
    allowed = {k: v for k, v in data.items() if k in EDITABLE_FIELDS}
    if not allowed:
        return jsonify({"error": "No editable fields in payload"}), 400

    set_fragments = []
    params = []
    changes = []

    for field_name, value in allowed.items():
        kind, max_len = EDITABLE_FIELDS[field_name]

        # Empty/null treated as clearing the field
        if value is None or (isinstance(value, str) and value.strip() == ""):
            set_fragments.append(f"{field_name} = NULL")
            changes.append(f"{field_name}→(cleared)")
            continue

        if kind == "int":
            ival = to_int(value)
            if ival is None:
                return jsonify({"error": f"{field_name} must be integer"}), 400
            set_fragments.append(f"{field_name} = %s")
            params.append(ival)
            changes.append(f"{field_name}→{ival}")

        elif kind in ("str", "text"):
            s = str(value).strip()
            if max_len:
                s = s[:max_len]
            set_fragments.append(f"{field_name} = %s")
            params.append(s)
            shown = s if len(s) < 40 else s[:37] + "..."
            changes.append(f"{field_name}→{shown}")

        elif kind == "json":
            if not isinstance(value, list):
                return jsonify({"error": f"{field_name} must be a list"}), 400
            set_fragments.append(f"{field_name} = %s::jsonb")
            params.append(json.dumps(value))
            changes.append(f"{field_name}→{value}")

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM submissions WHERE id = %s AND deleted_at IS NULL",
                (sid,),
            )
            if not cur.fetchone():
                return jsonify({"error": "Not found"}), 404

            sql = f"UPDATE submissions SET {', '.join(set_fragments)} WHERE id = %s"
            cur.execute(sql, params + [sid])

            cur.execute("""
                INSERT INTO submission_events (submission_id, actor_cp_id, kind, text)
                VALUES (%s, %s, 'comment', %s)
            """, (sid, g.user["cp_id"], "Edited: " + "; ".join(changes)))
            conn.commit()
    finally:
        put_app_conn(conn)

    return jsonify({"ok": True, "updated_fields": list(allowed.keys())}), 200


@bp.delete("/submissions/<int:sid>")
@require_staff
@require_admin_role
def delete_submission(sid: int):
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, deleted_at FROM submissions WHERE id = %s",
                (sid,),
            )
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Not found"}), 404
            if row["deleted_at"]:
                return jsonify({"ok": True, "already_deleted": True}), 200

            cur.execute("UPDATE submissions SET deleted_at = NOW() WHERE id = %s", (sid,))
            cur.execute("""
                INSERT INTO submission_events (submission_id, actor_cp_id, kind, text)
                VALUES (%s, %s, 'system', 'Submission archived by admin')
            """, (sid, g.user["cp_id"]))
            conn.commit()
    finally:
        put_app_conn(conn)
    return jsonify({"ok": True}), 200


# ============================================================
# Forms App integration — Schedule Visit
# ============================================================

@bp.get("/field-execs")
@require_staff
def list_field_execs():
    """Return field execs available for visit assignment.

    Source: properties DB, `users` table, where can_visit = TRUE AND is_active = TRUE.
    The Forms app expects the `name` field. We return id+name+email so the
    frontend can render a richer dropdown if it wants.
    """
    if not properties_configured():
        return jsonify({"field_execs": [], "error": "Properties DB not configured"}), 200

    pconn = get_props_conn()
    try:
        with pconn.cursor() as cur:
            cur.execute("""
                SELECT id, name, email
                FROM users
                WHERE can_visit = TRUE
                  AND is_active = TRUE
                  AND name IS NOT NULL
                  AND TRIM(name) <> ''
                ORDER BY name ASC
            """)
            rows = cur.fetchall()
    finally:
        put_props_conn(pconn)

    return jsonify({"field_execs": rows}), 200


# Required submission fields for scheduling — checked before pushing to Forms app.
# Empty/missing values block the request with a friendly error message.
# Note: owner_broker_name and contact_no are sourced from the CP record (channel_partners),
# not from seller_name/seller_phone — see schedule_visit() for the mapping.
SCHEDULE_REQUIRED_SUBMISSION_FIELDS = [
    ("society_name",   "Society"),
    ("bhk",            "BHK configuration"),
    ("sqft",           "Area (sqft)"),
    ("asking_price",   "Asking price"),
]


def _normalize_bhk_for_forms(bhk_str: str) -> str:
    """'3 BHK' / '3BHK' / '3' → '3BHK'.  None / empty → ''. """
    if not bhk_str:
        return ""
    digits = re.sub(r"[^0-9.]", "", str(bhk_str))
    if not digits:
        return ""
    return f"{digits.rstrip('.')}BHK"


def _split_full_name(full_name: str) -> tuple[str, str]:
    """'John Doe' → ('John', 'Doe'); 'Madonna' → ('Madonna', '')."""
    if not full_name:
        return "", ""
    parts = str(full_name).strip().split(None, 1)
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], parts[1]


def _normalize_phone_to_10_digits(phone: str) -> str:
    """Strip everything but digits; trim '+91' / '91' country code if present."""
    if not phone:
        return ""
    digits = re.sub(r"\D", "", str(phone))
    if len(digits) > 10 and digits.startswith("91"):
        digits = digits[2:]
    return digits


def _rupees_to_crores(rupees) -> float | None:
    """Convert asking_price (rupees) to crores (Forms app's expected unit)."""
    try:
        if rupees is None:
            return None
        return round(float(rupees) / 10_000_000, 4)
    except (TypeError, ValueError):
        return None


@bp.post("/submissions/<int:sid>/schedule-visit")
@require_staff
def schedule_visit(sid: int):
    """Push a listing to the external Forms app to create a visit schedule.

    Request body:
        {
          "schedule_date": "YYYY-MM-DD" (REQUIRED),
          "schedule_time": "HH:MM"      (REQUIRED, 24h),
          "field_exec_id": int          (REQUIRED — id from /admin/field-execs)
        }

    Behavior:
      - Idempotent on our side: if submission already has forms_uid, returns
        the existing UID without re-calling the Forms app.
      - Validates required submission fields (society, seller, contact, etc.).
        If any missing, returns 400 with `missing_fields` list.
      - Constructs payload, POSTs to FORMS_APP_URL + '/api/external/schedule'.
      - On 2xx: stores forms_uid + schedule date/time/field_exec_name on the
        submission row.
      - On Forms-app error: returns the error to the admin without touching
        the submission row.
      - Does NOT change submission status (admin moves to 'Visit Scheduled' first).
    """
    if not Config.FORMS_APP_URL or not Config.INTERNAL_API_KEY:
        return jsonify({
            "error": "Forms app integration not configured. "
                     "Set FORMS_APP_URL and INTERNAL_API_KEY env vars."
        }), 503

    data = request.get_json(silent=True) or {}
    schedule_date = to_str(data.get("schedule_date"))
    schedule_time = to_str(data.get("schedule_time"))
    field_exec_id = to_int(data.get("field_exec_id"))

    # Basic input validation
    body_errors = []
    if not schedule_date or not re.match(r"^\d{4}-\d{2}-\d{2}$", schedule_date):
        body_errors.append("schedule_date must be YYYY-MM-DD")
    else:
        try:
            sched_date_obj = datetime.strptime(schedule_date, "%Y-%m-%d").date()
            if sched_date_obj < datetime.now().date():
                body_errors.append("schedule_date cannot be in the past")
        except ValueError:
            body_errors.append("schedule_date is not a valid date")

    # Time: enforce strict HH:MM (pad single-digit hours like '9:30' → '09:30')
    if not schedule_time:
        body_errors.append("schedule_time is required")
    else:
        time_match = re.match(r"^(\d{1,2}):(\d{2})$", schedule_time)
        if not time_match:
            body_errors.append("schedule_time must be HH:MM (24-hr)")
        else:
            hh = int(time_match.group(1))
            mm = int(time_match.group(2))
            if hh < 0 or hh > 23 or mm < 0 or mm > 59:
                body_errors.append("schedule_time has out-of-range values")
            else:
                # Re-format to zero-padded HH:MM
                schedule_time = f"{hh:02d}:{mm:02d}"

    if not field_exec_id:
        body_errors.append("field_exec_id is required")
    if body_errors:
        return jsonify({"error": "Invalid request", "details": body_errors}), 400

    # Load the submission + its city + the CP who owns it (CP name/phone is
    # what we send as owner_broker_name/contact_no to the Forms app).
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT s.*, c.name AS city,
                       cp.name AS cp_name, cp.phone AS cp_phone
                FROM submissions s
                LEFT JOIN cities c ON c.id = s.city_id
                LEFT JOIN channel_partners cp ON cp.id = s.cp_id
                WHERE s.id = %s AND s.deleted_at IS NULL
            """, (sid,))
            sub = cur.fetchone()
    finally:
        put_app_conn(conn)

    if not sub:
        return jsonify({"error": "Submission not found"}), 404

    # Idempotency on our side: already scheduled?
    if sub.get("forms_uid"):
        return jsonify({
            "ok": True,
            "uid": sub["forms_uid"],
            "already_existed": True,
            "message": "Visit was already scheduled for this listing.",
        }), 200

    # Required-field validation
    missing = []
    for field, label in SCHEDULE_REQUIRED_SUBMISSION_FIELDS:
        val = sub.get(field)
        if val is None or (isinstance(val, str) and not val.strip()) or val == 0:
            missing.append({"field": field, "label": label})
    if missing:
        return jsonify({
            "error": "Cannot schedule visit — listing is missing required fields.",
            "missing_fields": missing,
        }), 400

    # Resolve field exec name from properties DB
    if not properties_configured():
        return jsonify({"error": "Properties DB not configured for field execs."}), 503
    pconn = get_props_conn()
    try:
        with pconn.cursor() as cur:
            cur.execute(
                "SELECT id, name, email FROM users WHERE id = %s AND can_visit = TRUE",
                (field_exec_id,),
            )
            exec_row = cur.fetchone()
    finally:
        put_props_conn(pconn)

    if not exec_row:
        return jsonify({"error": "Selected field exec is not authorized for visits."}), 400

    field_exec_name = exec_row["name"]

    # Whitelist city — Forms app only accepts these three values.
    ALLOWED_FORMS_CITIES = {"Gurgaon", "Noida", "Ghaziabad"}
    raw_city = (sub.get("city") or "").strip()
    # Try case-correct match first, then fall back to a case-insensitive lookup
    # so DB rows like 'gurgaon' don't break the call.
    city_match = None
    for allowed in ALLOWED_FORMS_CITIES:
        if raw_city.lower() == allowed.lower():
            city_match = allowed
            break
    if not city_match:
        return jsonify({
            "error": f"Cannot schedule visit — city '{raw_city}' is not supported by the Forms app. "
                     f"Allowed values: {', '.join(sorted(ALLOWED_FORMS_CITIES))}.",
            "missing_fields": [{"field": "city", "label": "City"}],
        }), 400
    city = city_match

    # CP info → owner_broker_name + contact_no (per convention, CP IS the broker
    # for any CP-listed property).
    cp_name = (sub.get("cp_name") or "").strip()
    cp_phone_raw = sub.get("cp_phone") or ""
    if not cp_name:
        return jsonify({
            "error": "Cannot schedule visit — CP name is missing on this listing's channel partner record.",
            "missing_fields": [{"field": "cp_name", "label": "CP name"}],
        }), 400

    first_name, last_name = _split_full_name(cp_name)
    contact_no = _normalize_phone_to_10_digits(cp_phone_raw)
    if len(contact_no) != 10 or contact_no.startswith("0"):
        return jsonify({
            "error": "Cannot schedule visit — CP phone is not a valid 10-digit number "
                     "(must not start with 0 and must be exactly 10 digits).",
            "missing_fields": [{"field": "cp_phone", "label": "CP phone"}],
        }), 400

    # area_sqft must be a positive integer
    area_sqft = int(sub.get("sqft") or 0)
    if area_sqft <= 0:
        return jsonify({
            "error": "Cannot schedule visit — area (sqft) must be greater than 0.",
            "missing_fields": [{"field": "sqft", "label": "Area (sqft)"}],
        }), 400

    demand_price_cr = _rupees_to_crores(sub.get("asking_price"))
    if demand_price_cr is None or demand_price_cr <= 0:
        return jsonify({
            "error": "Cannot schedule visit — asking price is invalid.",
            "missing_fields": [{"field": "asking_price", "label": "Asking price"}],
        }), 400

    # Locality lookup from properties.master_societies (source of truth for
    # society→locality mapping). Falls back to society_name if no row matches —
    # Forms app requires non-empty, so a non-empty fallback keeps the call alive
    # rather than hard-failing on a missing row.
    society_for_lookup = (sub.get("society_name") or "").strip()
    locality = ""
    if society_for_lookup and properties_configured():
        pconn2 = get_props_conn()
        try:
            with pconn2.cursor() as cur:
                cur.execute("""
                    SELECT locality
                    FROM master_societies
                    WHERE LOWER(REGEXP_REPLACE(society_name, '[^a-zA-Z0-9]', '', 'g'))
                          = LOWER(REGEXP_REPLACE(%s, '[^a-zA-Z0-9]', '', 'g'))
                      AND LOWER(TRIM(city)) = LOWER(%s)
                    LIMIT 1
                """, (society_for_lookup, city))
                row = cur.fetchone()
                if row and (row.get("locality") or "").strip():
                    locality = row["locality"].strip()
        finally:
            put_props_conn(pconn2)
    if not locality:
        # Fallback: use society_name itself so the Forms app's required-field
        # check doesn't 400 us. Logged so we can backfill master_societies later.
        log.warning(
            "[schedule_visit] No locality match for society=%r city=%s sid=%s — using society_name as fallback",
            society_for_lookup, city, sid,
        )
        locality = society_for_lookup or "Unknown"

    admin_name = (
        g.user.get("name")
        or g.user.get("phone")
        or f"admin-{g.user.get('admin_id') or g.user.get('rm_id') or 'unknown'}"
    )

    # lead_id is the public_id (e.g. 'OHLNC0042'), per Forms-app spec.
    # Falls back to internal id if public_id is somehow missing (shouldn't happen
    # for CP submissions but defensively handled).
    lead_id = sub.get("public_id") or str(sub["id"])

    payload = {
        "lead_id": lead_id,
        "society_name": sub.get("society_name") or "",
        "locality": locality,
        "city": city,
        "tower_no": sub.get("tower") or "",
        "unit_no": sub.get("unit_no") or "",
        "owner_broker_name": cp_name,
        "first_name": first_name,
        "last_name": last_name,
        "contact_no": contact_no,
        "configuration": _normalize_bhk_for_forms(sub.get("bhk")),
        "area_sqft": area_sqft,
        "demand_price": demand_price_cr,
        "source": "CP",
        "field_exec": field_exec_name,
        "assigned_by": admin_name,
        "schedule_date": schedule_date,
        "schedule_time": schedule_time,
    }

    # POST to Forms app
    forms_url = Config.FORMS_APP_URL.rstrip("/") + "/api/external/schedule"
    try:
        resp = requests.post(
            forms_url,
            json=payload,
            headers={
                "X-Internal-Key": Config.INTERNAL_API_KEY,
                "Content-Type": "application/json",
            },
            timeout=Config.FORMS_APP_TIMEOUT_SECONDS,
        )
    except requests.exceptions.Timeout:
        log.error("[schedule_visit] Forms app timeout sid=%s", sid)
        return jsonify({"error": "Forms app did not respond in time. Please try again."}), 504
    except requests.exceptions.RequestException as e:
        log.error("[schedule_visit] Forms app network error sid=%s: %s", sid, e)
        return jsonify({"error": f"Could not reach Forms app: {e}"}), 502

    # Parse response
    try:
        result = resp.json()
    except ValueError:
        result = {}

    if resp.status_code >= 400 or not result.get("success"):
        log.warning("[schedule_visit] Forms app returned %s sid=%s body=%s",
                    resp.status_code, sid, resp.text[:500])
        return jsonify({
            "error": result.get("error") or f"Forms app error (HTTP {resp.status_code})",
            "details": result,
        }), 502

    forms_uid = result.get("uid")
    already_existed = bool(result.get("already_existed"))
    if not forms_uid:
        return jsonify({"error": "Forms app did not return a UID."}), 502

    # Persist on our side
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE submissions
                SET forms_uid       = %s,
                    scheduled_date  = %s,
                    scheduled_time  = %s,
                    field_exec_name = %s
                WHERE id = %s
            """, (forms_uid, schedule_date, schedule_time, field_exec_name, sid))

            cur.execute("""
                INSERT INTO submission_events
                    (submission_id, actor_cp_id, kind, text)
                VALUES (%s, %s, 'system', %s)
            """, (
                sid,
                g.user.get("cp_id"),  # NULL for admins/RMs/managers — column allows it
                f"Visit scheduled for {schedule_date} {schedule_time} with {field_exec_name}. "
                f"Forms UID: {forms_uid}{' (already existed)' if already_existed else ''}",
            ))
            conn.commit()
    finally:
        put_app_conn(conn)

    return jsonify({
        "ok": True,
        "uid": forms_uid,
        "already_existed": already_existed,
        "scheduled_date": schedule_date,
        "scheduled_time": schedule_time,
        "field_exec_name": field_exec_name,
    }), 200


# ---- CP history ----

@bp.get("/cp/<int:cp_id>/submissions")
@require_staff
def cp_history(cp_id: int):
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT cp.id, cp.cp_code, cp.name, cp.phone, cp.company, cp.role,
                       c.name AS city
                FROM channel_partners cp
                LEFT JOIN cities c ON cp.city_id = c.id
                WHERE cp.id = %s
            """, (cp_id,))
            cp = cur.fetchone()
            if not cp:
                return jsonify({"error": "CP not found"}), 404

            scope_sql, scope_params = _scoped_city_filter(cur)
            cur.execute(f"""
                SELECT s.id, s.public_id, s.society_name, s.tower, s.unit_no, s.floor,
                       s.bhk, s.sqft, s.asking_price,
                       s.status, s.submitted_at, s.weak_match, s.deleted_at,
                       c.name AS city
                FROM submissions s
                LEFT JOIN cities c ON s.city_id = c.id
                WHERE s.cp_id = %s AND (s.deleted_at IS NULL OR s.withdraw_reason = 'cp_withdrawn') {scope_sql}
                ORDER BY s.submitted_at DESC
                LIMIT 500
            """, [cp_id, *scope_params])
            subs = cur.fetchall()

            summary = {stage: 0 for stage in VALID_STAGES}
            for s in subs:
                if s["status"] in summary:
                    summary[s["status"]] += 1
    finally:
        put_app_conn(conn)
    return jsonify({"cp": cp, "submissions": subs, "summary": summary}), 200


# ---- CSV export ----

@bp.get("/submissions.csv")
@require_staff
def export_csv():
    subs = _list_submissions_core()
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow([
        "Listing ID", "Internal ID", "Submitted at", "Status", "City", "Society",
        "Tower", "Unit", "Floor", "BHK", "Sqft",
        "Occupancy", "Furnishing", "Parking",
        "Exit facing", "Balcony facing", "Balcony view",
        "Asking",
        "Seller name", "Seller phone",
        "CP name", "CP code", "CP phone", "CP company",
    ])
    for s in subs:
        writer.writerow([
            s.get("public_id") or "",
            s["id"],
            s["submitted_at"].isoformat() if s.get("submitted_at") else "",
            s["status"],
            s["city"] or "", s["society_name"] or "",
            s["tower"] or "", s["unit_no"] or "", s["floor"] or "",
            s["bhk"] or "", s["sqft"] or "",
            s["occupancy_status"] or "", s["furnishing"] or "", s["parking"] or "",
            s["exit_facing"] or "", s["balcony_facing"] or "", s["balcony_view"] or "",
            s["asking_price"] or "",
            s["seller_name"] or "", s["seller_phone"] or "",
            s["cp_name"] or "", s["cp_code"] or "", s["cp_phone"] or "", s["cp_company"] or "",
        ])

    filename = f"openhouse-submissions-{datetime.utcnow().strftime('%Y%m%d-%H%M')}.csv"
    return Response(
        out.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ===================================================================
# Turn 2: RMs list, bulk status, CP notes
# ===================================================================


@bp.get("/rms")
@require_staff
def list_rms():
    """RMs from the `rms` table — used for the admin's CP\u2194RM assignment dropdown.

    Returns: { rms: [ {id, name, phone, email, city_id, city, is_manager}, ... ] }
    Active only, ordered by name. If city_id is present, joins to cities for display.
    Defensive: falls back gracefully if city_id/is_manager columns aren't there yet.
    """
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            try:
                cur.execute("""
                    SELECT r.id, r.name, r.phone, r.email,
                           r.city_id, c.name AS city,
                           COALESCE(r.is_manager, FALSE) AS is_manager
                    FROM rms r
                    LEFT JOIN cities c ON r.city_id = c.id
                    WHERE COALESCE(r.is_active, TRUE) = TRUE
                    ORDER BY r.name ASC, r.id ASC
                """)
                rows = cur.fetchall()
            except Exception:
                conn.rollback()
                # Fallback for schemas missing city_id / is_manager
                cur.execute("""
                    SELECT r.id, r.name, r.phone, r.email,
                           NULL::integer AS city_id, NULL::varchar AS city,
                           FALSE AS is_manager
                    FROM rms r
                    WHERE COALESCE(r.is_active, TRUE) = TRUE
                    ORDER BY r.name ASC, r.id ASC
                """)
                rows = cur.fetchall()
    finally:
        put_app_conn(conn)
    return jsonify({"rms": rows}), 200


@bp.patch("/channel-partners/<int:cp_id>/rm")
@require_staff
def set_cp_rm(cp_id: int):
    """Admin-only: set channel_partners.rm_id for a CP.

    Request body: { rm_id: <rms.id> | null }
    Response:     { ok: true, rm_id: <value> }

    Managers/RMs can VIEW the CP\u2019s current RM (via submission detail) but
    cannot CHANGE it. Only role='admin' passes the guard.

    If rm_id is null/omitted, clears the CP\u2019s RM assignment (no-RM state).
    If rm_id is provided, we validate it exists in the `rms` table.
    """
    # Extra guard on top of require_staff — only true admins may reassign
    if g.user.get("role") != "admin":
        return jsonify({"error": "Only admins can change a CP's RM assignment"}), 403

    data = request.get_json(silent=True) or {}
    rm_id_raw = data.get("rm_id")
    if rm_id_raw in ("", None):
        new_rm_id = None
    else:
        try:
            new_rm_id = int(rm_id_raw)
        except (TypeError, ValueError):
            return jsonify({"error": "rm_id must be an integer or null"}), 400

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            # Verify CP exists
            cur.execute("SELECT id FROM channel_partners WHERE id = %s", (cp_id,))
            if cur.fetchone() is None:
                return jsonify({"error": "Channel partner not found"}), 404

            # If setting to a specific RM, verify that RM exists + is active
            if new_rm_id is not None:
                try:
                    cur.execute(
                        "SELECT id FROM rms WHERE id = %s AND COALESCE(is_active, TRUE) = TRUE",
                        (new_rm_id,),
                    )
                except Exception:
                    conn.rollback()
                    cur.execute("SELECT id FROM rms WHERE id = %s", (new_rm_id,))
                if cur.fetchone() is None:
                    return jsonify({"error": "RM not found or inactive"}), 404

            cur.execute(
                "UPDATE channel_partners SET rm_id = %s WHERE id = %s",
                (new_rm_id, cp_id),
            )
            conn.commit()
    except Exception as e:
        conn.rollback()
        return jsonify({"error": "Update failed", "detail": str(e)}), 500
    finally:
        put_app_conn(conn)

    return jsonify({"ok": True, "rm_id": new_rm_id}), 200


@bp.post("/submissions/bulk-status")
@require_staff
def bulk_status():
    """
    Bulk status change.
    Body: { "ids": [1, 2, 3], "status": "Evaluation" }
    Max 200 IDs per call.
    """
    data = request.get_json(silent=True) or {}
    ids = data.get("ids") or []
    new_status = to_str(data.get("status"))

    if not isinstance(ids, list) or not ids:
        return jsonify({"error": "ids must be a non-empty list"}), 400
    if len(ids) > 200:
        return jsonify({"error": "Max 200 IDs per bulk operation"}), 400
    if not new_status or new_status not in VALID_STAGES:
        return jsonify({"error": f"Invalid status. Must be one of: {VALID_STAGES}"}), 400

    # Coerce IDs to int
    clean_ids = []
    for v in ids:
        iv = to_int(v)
        if iv is None:
            return jsonify({"error": f"Invalid id: {v}"}), 400
        clean_ids.append(iv)

    conn = get_app_conn()
    updated, skipped = 0, 0
    try:
        with conn.cursor() as cur:
            scope_sql, scope_params = _scoped_city_filter(cur)
            # Pull in-scope, not-deleted, not-already-at-target
            cur.execute(f"""
                SELECT s.id, s.status FROM submissions s
                LEFT JOIN cities c ON s.city_id = c.id
                WHERE s.id = ANY(%s)
                  AND s.deleted_at IS NULL
                  {scope_sql}
            """, [clean_ids, *scope_params])
            rows = cur.fetchall()
            in_scope = {r["id"]: r["status"] for r in rows}

            for sid, old_status in in_scope.items():
                if old_status == new_status:
                    skipped += 1
                    continue
                cur.execute(
                    "UPDATE submissions SET status = %s WHERE id = %s",
                    (new_status, sid),
                )
                cur.execute("""
                    INSERT INTO submission_events
                        (submission_id, actor_cp_id, kind, from_status, to_status, text)
                    VALUES (%s, %s, 'status_change', %s, %s, 'Bulk action')
                """, (sid, g.user["cp_id"], old_status, new_status))
                updated += 1

            out_of_scope = len(clean_ids) - len(in_scope)
            conn.commit()
    finally:
        put_app_conn(conn)

    return jsonify({
        "ok": True,
        "updated": updated,
        "skipped_same_status": skipped,
        "out_of_scope_or_deleted": out_of_scope,
    }), 200


@bp.get("/cp/<int:cp_id>/notes")
@require_staff
def list_cp_notes(cp_id: int):
    """List notes for a CP. RM can read notes but only admin creates them."""
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT n.id, n.text, n.created_at,
                       cp.name AS actor_name, cp.role AS actor_role
                FROM cp_notes n
                JOIN channel_partners cp ON n.actor_cp_id = cp.id
                WHERE n.cp_id = %s
                ORDER BY n.created_at DESC
                LIMIT 200
            """, (cp_id,))
            notes = cur.fetchall()
    finally:
        put_app_conn(conn)
    return jsonify({"notes": notes}), 200


@bp.post("/cp/<int:cp_id>/notes")
@require_staff
@require_admin_role
def add_cp_note(cp_id: int):
    """Admin-only: add a timestamped note on a CP."""
    data = request.get_json(silent=True) or {}
    text = to_str(data.get("text"))
    if not text or not text.strip():
        return jsonify({"error": "Note text required"}), 400
    if len(text) > 2000:
        return jsonify({"error": "Note too long (max 2000 chars)"}), 400

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            # Ensure CP exists
            cur.execute("SELECT id FROM channel_partners WHERE id = %s", (cp_id,))
            if not cur.fetchone():
                return jsonify({"error": "CP not found"}), 404

            cur.execute("""
                INSERT INTO cp_notes (cp_id, actor_cp_id, text)
                VALUES (%s, %s, %s)
                RETURNING id, created_at
            """, (cp_id, g.user["cp_id"], text.strip()))
            row = cur.fetchone()
            conn.commit()
    finally:
        put_app_conn(conn)

    return jsonify({
        "ok": True,
        "note_id": row["id"],
        "created_at": row["created_at"],
    }), 201


@bp.delete("/cp/notes/<int:note_id>")
@require_staff
@require_admin_role
def delete_cp_note(note_id: int):
    """Admin-only: delete a CP note (hard delete since these are low-stakes)."""
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM cp_notes WHERE id = %s RETURNING id", (note_id,))
            if not cur.fetchone():
                return jsonify({"error": "Not found"}), 404
            conn.commit()
    finally:
        put_app_conn(conn)
    return jsonify({"ok": True}), 200