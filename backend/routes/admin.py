"""Admin + RM endpoints under /api/admin/*.

Access: require_staff (role = 'rm' or 'admin').
Scope rules:
  - Admin sees all cities.
  - RM sees only their own city.

Endpoints:
  GET  /api/admin/submissions               — list with filters
  GET  /api/admin/submissions/<id>          — one submission + events
  POST /api/admin/submissions/<id>/status   — change status (logs event)
  POST /api/admin/submissions/<id>/comment  — add comment
  GET  /api/admin/submissions.csv           — export filtered results
"""

import csv
import io
from datetime import datetime

from flask import Blueprint, Response, g, jsonify, request

from auth import require_staff
from db import get_app_conn, put_app_conn
from utils import to_str

bp = Blueprint("admin", __name__, url_prefix="/api/admin")

VALID_STAGES = ["Submitted", "Evaluation", "Offer Given", "Visit Scheduled", "Rejected"]


# ---- helpers ----

def _scoped_city_filter(cur):
    """
    Returns (where_sql, params) fragment to restrict results by the current staff's scope.
    Admin: no restriction. RM: only their city_id.
    """
    role = g.user.get("role", "cp")
    if role == "admin":
        return "", []
    # role == 'rm'
    city_id = g.user.get("city_id")
    if not city_id:
        # RM without a city shouldn't exist, but be safe
        return "AND FALSE", []
    return "AND s.city_id = %s", [city_id]


def _apply_filters(base_sql: str, params: list):
    """Append filters from query string to base SQL."""
    status = to_str(request.args.get("status"))
    city = to_str(request.args.get("city"))
    search = to_str(request.args.get("search"))
    since_days = request.args.get("since_days", type=int)

    if status and status in VALID_STAGES:
        base_sql += " AND s.status = %s"
        params.append(status)

    if city:
        base_sql += " AND c.name = %s"
        params.append(city)

    if search:
        base_sql += """ AND (
            s.society_name ILIKE %s
            OR cp.cp_code ILIKE %s
            OR cp.name ILIKE %s
            OR s.unit_no ILIKE %s
        )"""
        like = f"%{search}%"
        params.extend([like, like, like, like])

    if since_days and since_days > 0:
        base_sql += " AND s.submitted_at > NOW() - (%s || ' days')::interval"
        params.append(str(since_days))

    return base_sql, params


def _list_submissions_core():
    """Shared query used by JSON list + CSV export."""
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            scope_sql, scope_params = _scoped_city_filter(cur)
            base_sql = f"""
                SELECT
                    s.id, s.society_name, s.tower, s.unit_no, s.floor,
                    s.sqft, s.bhk, s.furnishing, s.registry_status,
                    s.parking, s.exit_facing, s.balcony_facing, s.balcony_view,
                    s.asking_price, s.closing_price,
                    s.seller_name, s.seller_phone,
                    s.status, s.submitted_at, s.photos, s.weak_match,
                    c.name AS city,
                    cp.cp_code, cp.name AS cp_name, cp.phone AS cp_phone,
                    cp.company AS cp_company
                FROM submissions s
                LEFT JOIN cities c ON s.city_id = c.id
                JOIN channel_partners cp ON s.cp_id = cp.id
                WHERE TRUE {scope_sql}
            """
            params = list(scope_params)
            sql, params = _apply_filters(base_sql, params)
            sql += " ORDER BY s.submitted_at DESC LIMIT 500"

            cur.execute(sql, params)
            return cur.fetchall()
    finally:
        put_app_conn(conn)


def _stage_counts():
    """Counts by stage for the current scope + filters."""
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            scope_sql, scope_params = _scoped_city_filter(cur)
            base_sql = f"""
                SELECT s.status, COUNT(*) AS cnt
                FROM submissions s
                LEFT JOIN cities c ON s.city_id = c.id
                JOIN channel_partners cp ON s.cp_id = cp.id
                WHERE TRUE {scope_sql}
            """
            params = list(scope_params)

            # Apply only city + search, NOT status (else all counts collapse to 1 stage)
            city = to_str(request.args.get("city"))
            search = to_str(request.args.get("search"))
            since_days = request.args.get("since_days", type=int)

            if city:
                base_sql += " AND c.name = %s"
                params.append(city)
            if search:
                base_sql += """ AND (
                    s.society_name ILIKE %s OR cp.cp_code ILIKE %s
                    OR cp.name ILIKE %s OR s.unit_no ILIKE %s
                )"""
                like = f"%{search}%"
                params.extend([like, like, like, like])
            if since_days and since_days > 0:
                base_sql += " AND s.submitted_at > NOW() - (%s || ' days')::interval"
                params.append(str(since_days))

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
                SELECT
                    s.*,
                    c.name AS city,
                    cp.cp_code, cp.name AS cp_name, cp.phone AS cp_phone,
                    cp.company AS cp_company
                FROM submissions s
                LEFT JOIN cities c ON s.city_id = c.id
                JOIN channel_partners cp ON s.cp_id = cp.id
                WHERE s.id = %s {scope_sql}
            """, [sid, *scope_params])
            submission = cur.fetchone()
            if not submission:
                return jsonify({"error": "Not found or out of scope"}), 404

            # Events timeline
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
                SELECT s.id, s.status
                FROM submissions s
                LEFT JOIN cities c ON s.city_id = c.id
                WHERE s.id = %s {scope_sql}
                FOR UPDATE
            """, [sid, *scope_params])
            existing = cur.fetchone()
            if not existing:
                return jsonify({"error": "Not found or out of scope"}), 404

            old_status = existing["status"]
            if old_status == new_status:
                return jsonify({"ok": True, "unchanged": True}), 200

            cur.execute(
                "UPDATE submissions SET status = %s WHERE id = %s",
                (new_status, sid),
            )

            cur.execute("""
                INSERT INTO submission_events
                    (submission_id, actor_cp_id, kind, from_status, to_status)
                VALUES (%s, %s, 'status_change', %s, %s)
            """, (sid, g.user["cp_id"], old_status, new_status))
            conn.commit()
    finally:
        put_app_conn(conn)

    return jsonify({"ok": True, "from": old_status, "to": new_status}), 200


@bp.post("/submissions/<int:sid>/comment")
@require_staff
def add_comment(sid: int):
    data = request.get_json(silent=True) or {}
    text = to_str(data.get("text"))
    if not text or len(text.strip()) == 0:
        return jsonify({"error": "Comment text required"}), 400
    if len(text) > 2000:
        return jsonify({"error": "Comment too long (max 2000 chars)"}), 400

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            scope_sql, scope_params = _scoped_city_filter(cur)
            cur.execute(f"""
                SELECT s.id FROM submissions s
                LEFT JOIN cities c ON s.city_id = c.id
                WHERE s.id = %s {scope_sql}
            """, [sid, *scope_params])
            if not cur.fetchone():
                return jsonify({"error": "Not found or out of scope"}), 404

            cur.execute("""
                INSERT INTO submission_events
                    (submission_id, actor_cp_id, kind, text)
                VALUES (%s, %s, 'comment', %s)
                RETURNING id, created_at
            """, (sid, g.user["cp_id"], text.strip()))
            row = cur.fetchone()
            conn.commit()
    finally:
        put_app_conn(conn)

    return jsonify({"ok": True, "event_id": row["id"], "created_at": row["created_at"]}), 201


@bp.get("/submissions.csv")
@require_staff
def export_csv():
    subs = _list_submissions_core()

    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow([
        "ID", "Submitted at", "Status", "City", "Society",
        "Tower", "Unit", "Floor", "BHK", "Sqft",
        "Registry", "Furnishing", "Parking",
        "Exit facing", "Balcony facing", "Balcony view",
        "Asking", "Closing",
        "Seller name", "Seller phone",
        "CP name", "CP code", "CP phone", "CP company",
    ])
    for s in subs:
        writer.writerow([
            s["id"],
            s["submitted_at"].isoformat() if s.get("submitted_at") else "",
            s["status"],
            s["city"] or "",
            s["society_name"] or "",
            s["tower"] or "", s["unit_no"] or "", s["floor"] or "",
            s["bhk"] or "", s["sqft"] or "",
            s["registry_status"] or "", s["furnishing"] or "", s["parking"] or "",
            s["exit_facing"] or "", s["balcony_facing"] or "", s["balcony_view"] or "",
            s["asking_price"] or "", s["closing_price"] or "",
            s["seller_name"] or "", s["seller_phone"] or "",
            s["cp_name"] or "", s["cp_code"] or "", s["cp_phone"] or "", s["cp_company"] or "",
        ])

    filename = f"openhouse-submissions-{datetime.utcnow().strftime('%Y%m%d-%H%M')}.csv"
    return Response(
        out.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )