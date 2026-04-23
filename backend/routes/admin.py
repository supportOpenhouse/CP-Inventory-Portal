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
from datetime import datetime
from functools import wraps

from flask import Blueprint, Response, g, jsonify, request

from auth import require_staff
from db import get_app_conn, put_app_conn
from utils import to_int, to_str

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
    RM scope: city_id match OR assigned_rm_id match (both included).
             Unapproved submissions are hidden from RMs (admin-only review queue).
    Admin: no restriction.
    """
    role = g.user.get("role", "cp")
    if role == "admin":
        return "", []
    city_id = g.user.get("city_id")
    cp_id = g.user.get("cp_id")
    if not city_id and not cp_id:
        return "AND FALSE", []
    # Include rows in RM's city OR explicitly assigned to them.
    # Exclude Unapproved — those are in the admin review queue only.
    return (
        "AND (s.city_id = %s OR s.assigned_rm_id = %s) AND s.status != 'Unapproved'",
        [city_id, cp_id],
    )


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
    include_deleted = request.args.get("include_deleted", "false").lower() == "true"

    if not include_deleted:
        base_sql += " AND s.deleted_at IS NULL"

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
                    c.name AS city,
                    cp.id AS cp_id,
                    cp.cp_code, cp.name AS cp_name, cp.phone AS cp_phone,
                    cp.company AS cp_company,
                    rm.name AS assigned_rm_name
                FROM submissions s
                LEFT JOIN cities c ON s.city_id = c.id
                JOIN channel_partners cp ON s.cp_id = cp.id
                LEFT JOIN channel_partners rm ON s.assigned_rm_id = rm.id
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
                WHERE TRUE {scope_sql} AND s.deleted_at IS NULL
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
                       rm.name AS assigned_rm_name
                FROM submissions s
                LEFT JOIN cities c ON s.city_id = c.id
                JOIN channel_partners cp ON s.cp_id = cp.id
                LEFT JOIN channel_partners rm ON s.assigned_rm_id = rm.id
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

            # Unapproved submissions can only be moved by admins (approve/reject)
            is_admin = bool(g.user.get("is_admin", False))
            if (old_status == "Unapproved" or new_status == "Unapproved") and not is_admin:
                return jsonify({"error": "Only admins can approve or reject flagged submissions"}), 403

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
                WHERE s.id = %s AND s.deleted_at IS NULL {scope_sql}
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
                WHERE s.cp_id = %s AND s.deleted_at IS NULL {scope_sql}
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
    """All RMs and admins, for the assignment dropdown."""
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT cp.id, cp.name, cp.cp_code, cp.role,
                       c.name AS city
                FROM channel_partners cp
                LEFT JOIN cities c ON cp.city_id = c.id
                WHERE cp.role IN ('rm', 'admin') AND cp.is_active = TRUE
                ORDER BY cp.role DESC, cp.name ASC
            """)
            rows = cur.fetchall()
    finally:
        put_app_conn(conn)
    return jsonify({"rms": rows}), 200


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
                # Unapproved transitions are admin-only
                is_admin = bool(g.user.get("is_admin", False))
                if (old_status == "Unapproved" or new_status == "Unapproved") and not is_admin:
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