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

VALID_STAGES = ["Unapproved", "Submitted", "Offer Given", "Visit Scheduled", "Visit Completed", "Price Rejected", "Duplicate Rejected"]


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
    rm_id = request.args.get("rm_id", type=int)
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

    if rm_id:
        # Filter by the CP's assigned RM (channel_partners.rm_id), which is
        # the canonical "owner" relationship. Note: this is distinct from
        # submissions.assigned_rm_id (legacy per-listing assignment).
        base_sql += " AND cp.rm_id = %s"
        params.append(rm_id)

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


def _sync_visit_completed_from_properties() -> int:
    """Promote 'Visit Scheduled' submissions to 'Visit Completed' based on
    the Properties DB.

    Logic:
      1. Find submissions where status='Visit Scheduled', deleted_at IS NULL,
         and public_id IS NOT NULL (the lead_id we send to the Forms app).
      2. Look up properties.lead_id matching those public_ids where
         properties.visit_submitted_at IS NOT NULL.
      3. UPDATE submissions SET status='Visit Completed' for the matches and
         seed a 'system' submission_event so the timeline records the sync.

    Idempotent (status='Visit Completed' rows are already past this filter).
    Read-only on Properties DB. Best-effort: any error is swallowed and
    logged so the calling list endpoint still returns successfully.

    Returns: count of submissions promoted in this call.
    """
    if not properties_configured():
        return 0
    try:
        # 1. Collect candidate public_ids
        conn = get_app_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT id, public_id FROM submissions
                    WHERE status = 'Visit Scheduled'
                      AND public_id IS NOT NULL
                      AND deleted_at IS NULL
                """)
                candidates = cur.fetchall()
        finally:
            put_app_conn(conn)

        if not candidates:
            return 0

        public_ids = [c["public_id"] for c in candidates]

        # 2. Look up properties for matches with visit_submitted_at set
        pconn = get_props_conn()
        try:
            with pconn.cursor() as cur:
                cur.execute("""
                    SELECT lead_id, visit_submitted_at
                    FROM properties
                    WHERE lead_id = ANY(%s)
                      AND visit_submitted_at IS NOT NULL
                """, (public_ids,))
                matches = cur.fetchall()
        finally:
            put_props_conn(pconn)

        if not matches:
            return 0

        completed_lead_ids = [m["lead_id"] for m in matches]
        ts_by_lead = {m["lead_id"]: m["visit_submitted_at"] for m in matches}

        # 3. Promote and log per-row events
        conn = get_app_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE submissions
                    SET status = 'Visit Completed'
                    WHERE public_id = ANY(%s)
                      AND status = 'Visit Scheduled'
                    RETURNING id, public_id
                """, (completed_lead_ids,))
                updated = cur.fetchall()

                for u in updated:
                    ts = ts_by_lead.get(u["public_id"])
                    cur.execute("""
                        INSERT INTO submission_events
                            (submission_id, actor_cp_id, kind, to_status, text)
                        VALUES (%s, NULL, 'system', 'Visit Completed', %s)
                    """, (
                        u["id"],
                        f"Visit completion synced from properties.visit_submitted_at "
                        f"({ts.isoformat() if ts else 'unknown'}).",
                    ))
                conn.commit()
        finally:
            put_app_conn(conn)

        if updated:
            log.info(
                "[sync_visit_completed] promoted %d submissions to Visit Completed",
                len(updated),
            )
        return len(updated)
    except Exception:
        # Best-effort: never break the admin list because of a sync hiccup.
        log.exception("[sync_visit_completed] failed; admin list will continue uninterrupted")
        return 0


def _sync_unit_details_from_properties() -> int:
    """Overwrite tower / unit_no / floor on submissions from the Forms-app
    properties table. Field execs sometimes register the actual unit
    details on-site (especially for 'unit-less' submissions where the CP
    didn't know them at submit time), and properties is the ground truth
    after a visit.

    Logic:
      1. Collect submissions where forms_uid IS NOT NULL, deleted_at IS NULL.
      2. Look up properties.uid = ANY(forms_uids); pull tower_no, unit_no,
         floor from each match.
      3. For each match, UPDATE submissions SET tower / unit_no / floor
         from the properties values — always overwrite (per product
         decision: properties is authoritative). Only skip a column when
         the properties value is NULL/empty (don't blank out an existing
         value with NULL).
      4. Only commit a row + log an event when at least one column
         actually changed (idempotent on repeat runs).

    Cross-DB read on properties; write on submissions. Best-effort: any
    error is swallowed and logged so the calling list endpoint still
    returns successfully.

    Returns: count of submissions updated in this call.
    """
    if not properties_configured():
        return 0
    try:
        # 1. Collect candidates (submissions with a forms_uid)
        conn = get_app_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT id, forms_uid, tower, unit_no, floor
                    FROM submissions
                    WHERE forms_uid IS NOT NULL
                      AND deleted_at IS NULL
                """)
                candidates = cur.fetchall()
        finally:
            put_app_conn(conn)

        if not candidates:
            return 0

        forms_uids = [c["forms_uid"] for c in candidates]
        sub_by_uid = {c["forms_uid"]: c for c in candidates}

        # 2. Fetch matching properties rows. floor::text guards against the
        # properties.floor column being INT (see duplicate_check.py).
        pconn = get_props_conn()
        try:
            with pconn.cursor() as cur:
                cur.execute("""
                    SELECT uid,
                           NULLIF(TRIM(COALESCE(tower_no, '')), '') AS tower_no,
                           NULLIF(TRIM(COALESCE(unit_no, '')),   '') AS unit_no,
                           NULLIF(TRIM(COALESCE(floor::text, '')), '') AS floor
                    FROM properties
                    WHERE uid = ANY(%s)
                """, (forms_uids,))
                props = cur.fetchall()
        finally:
            put_props_conn(pconn)

        if not props:
            return 0

        # 3. Apply updates — overwrite when properties has a value AND it
        # differs from what's currently on the submission.
        updated_count = 0
        conn = get_app_conn()
        try:
            with conn.cursor() as cur:
                for p in props:
                    sub = sub_by_uid.get(p["uid"])
                    if not sub:
                        continue

                    sets = []
                    params = []
                    changes = []

                    if p["tower_no"] is not None and p["tower_no"] != (sub["tower"] or ""):
                        sets.append("tower = %s")
                        params.append(p["tower_no"])
                        changes.append(f"tower: {sub['tower'] or '∅'} → {p['tower_no']}")
                    if p["unit_no"] is not None and p["unit_no"] != (sub["unit_no"] or ""):
                        sets.append("unit_no = %s")
                        params.append(p["unit_no"])
                        changes.append(f"unit_no: {sub['unit_no'] or '∅'} → {p['unit_no']}")
                    if p["floor"] is not None and p["floor"] != (sub["floor"] or ""):
                        sets.append("floor = %s")
                        params.append(p["floor"])
                        changes.append(f"floor: {sub['floor'] or '∅'} → {p['floor']}")

                    if not sets:
                        continue

                    params.append(sub["id"])
                    cur.execute(
                        f"UPDATE submissions SET {', '.join(sets)} WHERE id = %s",
                        params,
                    )
                    cur.execute("""
                        INSERT INTO submission_events
                            (submission_id, actor_cp_id, kind, text)
                        VALUES (%s, NULL, 'system', %s)
                    """, (
                        sub["id"],
                        f"Unit details synced from properties (uid={p['uid']}): "
                        f"{'; '.join(changes)}.",
                    ))
                    updated_count += 1
                conn.commit()
        finally:
            put_app_conn(conn)

        if updated_count:
            log.info(
                "[sync_unit_details] overwrote unit fields on %d submissions from properties",
                updated_count,
            )
        return updated_count
    except Exception:
        log.exception("[sync_unit_details] failed; admin list will continue uninterrupted")
        return 0


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
                    s.status, s.submitted_at, s.photos, s.weak_match, s.collated_match, s.submissions_match,
                    s.deleted_at, s.drive_links, s.assigned_rm_id, s.listing_rm_id,
                    s.unit_less, s.perfect_match_at_submit, s.withdraw_reason,
                    s.forms_uid, s.scheduled_date, s.scheduled_time, s.field_exec_name,
                    s.submitted_by_name,
                    c.name AS city,
                    cp.id AS cp_id,
                    cp.cp_code, cp.name AS cp_name, cp.phone AS cp_phone,
                    cp.company AS cp_company,
                    rm.name AS assigned_rm_name,
                    listing_rm.name AS listing_rm_name,
                    acq.acq_price_lakhs, acq.acq_sqft
                FROM submissions s
                LEFT JOIN cities c ON s.city_id = c.id
                JOIN channel_partners cp ON s.cp_id = cp.id
                LEFT JOIN channel_partners rm ON s.assigned_rm_id = rm.id
                LEFT JOIN rms listing_rm ON s.listing_rm_id = listing_rm.id
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
    # Auto-sync Visit Scheduled -> Visit Completed from properties.visit_submitted_at
    # before returning the list, so the admin board reflects field-level updates
    # without needing a separate Forms-app webhook. Best-effort; doesn't block
    # the response on properties-side errors.
    _sync_visit_completed_from_properties()
    # Pull tower/unit_no/floor back from properties for any submission with a
    # forms_uid — field execs register the actual unit details on-site and
    # properties is the authoritative source after a visit. Always overwrites.
    _sync_unit_details_from_properties()
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
                       listing_rm.name AS listing_rm_name,
                       acq.acq_price_lakhs, acq.acq_sqft
                FROM submissions s
                LEFT JOIN cities c ON s.city_id = c.id
                JOIN channel_partners cp ON s.cp_id = cp.id
                LEFT JOIN rms cp_rm ON cp.rm_id = cp_rm.id
                LEFT JOIN channel_partners rm ON s.assigned_rm_id = rm.id
                LEFT JOIN rms listing_rm ON s.listing_rm_id = listing_rm.id
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
    """Admin sends a counter offer. Submission stays in 'Submitted'.

    Payload: { "price_rupees": 9500000 }  (integer, in rupees)
    OR       { "price_lakhs":  95 }        (integer, in lakhs — converted server-side)

    Stage does NOT change here — stays 'Submitted'. CP responds via
    /api/submissions/<id>/counter-offer-response, which moves to
    'Offer Given' (accept) or 'Price Rejected' (reject).

    Note: the gate used to be 'Evaluation' before that stage was removed
    in the May 2026 pipeline simplification. 'Submitted' now plays the
    same role (listing is in admin's hands awaiting decision).
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
            if row["status"] != "Submitted":
                return jsonify({
                    "error": "Counter offer only allowed when status is 'Submitted'",
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


def _rupees_to_lakhs_int(rupees) -> int | None:
    """Convert asking_price (rupees) to integer lakhs (Forms app's expected unit).

    Forms app's `demand_price` column is an INTEGER, and they expect lakhs
    (per Indian real-estate convention). 99 lakhs is sent as `99`, 1.5 Cr
    as `150`. We round to the nearest lakh to avoid losing precision on
    fractional crores like 0.99 Cr (=99 L exactly) or 1.45 Cr (=145 L).
    """
    try:
        if rupees is None:
            return None
        return round(float(rupees) / 100_000)
    except (TypeError, ValueError):
        return None


def _resolve_admin_name_for_forms(admin_phone: str) -> str | None:
    """Look up the admin's name in properties.users by phone — used for
    `assigned_by` on the Forms-app payload.

    Forms app validates assigned_by against the same properties.users table
    (where we also pull field_exec from). So we need to resolve the calling
    admin's display name in that table by matching their phone number.

    Phone may be stored differently on each side (with/without +91, with/without
    spaces). We normalize both sides to digits-only and match by suffix to
    handle variants like '+91 8595594789' / '918595594789' / '8595594789'.
    Returns None if no active user matches.
    """
    if not admin_phone or not properties_configured():
        return None
    digits = re.sub(r"\D", "", str(admin_phone))
    if len(digits) < 10:
        return None
    last_10 = digits[-10:]  # match against the last 10 digits regardless of country code
    pconn = get_props_conn()
    try:
        with pconn.cursor() as cur:
            cur.execute("""
                SELECT name
                FROM users
                WHERE REGEXP_REPLACE(COALESCE(phone, ''), '\\D', '', 'g') LIKE %s
                  AND is_active = TRUE
                ORDER BY id ASC
                LIMIT 1
            """, (f"%{last_10}",))
            row = cur.fetchone()
            return row["name"] if row else None
    finally:
        put_props_conn(pconn)


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

    demand_price_lakhs = _rupees_to_lakhs_int(sub.get("asking_price"))
    if demand_price_lakhs is None or demand_price_lakhs <= 0:
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

    # Resolve the calling admin's name from properties.users (Forms app
    # validates assigned_by against the same table).
    admin_phone = g.user.get("phone") or ""
    admin_name = _resolve_admin_name_for_forms(admin_phone)
    if not admin_name:
        return jsonify({
            "error": (
                f"Cannot schedule visit — your account ({admin_phone}) is not registered "
                f"as an active user in the Forms app. Add this user to properties.users "
                f"with is_active=TRUE, then try again."
            ),
            "missing_fields": [{"field": "admin_account", "label": "Admin account in Forms users"}],
        }), 400

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
        "demand_price": demand_price_lakhs,
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


# ---- Bulk schedule visit ----

# Per-request hard cap. Each item triggers one Forms-app POST (sequential),
# so this also bounds the worst-case admin-facing wait time.
BULK_SCHEDULE_VISIT_MAX_ITEMS = 20


@bp.post("/submissions/bulk-schedule-visit")
@require_staff
def bulk_schedule_visit():
    """Schedule visits for multiple submissions in one request.

    Request body:
        {
          "schedule_date": "YYYY-MM-DD"   (REQUIRED, applied to all items),
          "schedule_time": "HH:MM"        (OPTIONAL fallback if an item omits
                                            its own schedule_time),
          "items": [
            { "id": int, "field_exec_id": int, "schedule_time": "HH:MM" },
            ...
          ]
        }

    Per-item `schedule_time` overrides the top-level fallback. At least one
    of (item.schedule_time, top-level schedule_time) must be present per
    item. Time format is 24-hr HH:MM, validated server-side.

    Behavior:
      - Hard cap: BULK_SCHEDULE_VISIT_MAX_ITEMS items per request.
      - Phase 1 (no side effects): pre-validate every item — submission exists,
        required fields present, city in whitelist, field exec authorized,
        CP name + 10-digit phone, sqft > 0, asking_price > 0. If ANY item
        fails pre-validation, return 400 with per-item errors. Nothing is
        sent to the Forms app.
      - Phase 2: sequential Forms-app POSTs. Each call is independent —
        a failure on one item does not abort the rest. Per-item results
        are aggregated and returned.
      - Idempotent: rows with forms_uid already set are reported as
        already_existed=true and counted as success without re-calling Forms.
      - Persists successful results in a single transaction.

    Response:
      {
        "ok": true|false,           # false iff any item failed in Phase 2
        "results": [
          {"id": <sid>, "ok": true,  "uid": ..., "already_existed": ..., ...},
          {"id": <sid>, "ok": false, "error": "..."},
          ...
        ],
        "summary": {"total", "succeeded", "failed", "already_scheduled"}
      }
    """
    # 1. Config
    if not Config.FORMS_APP_URL or not Config.INTERNAL_API_KEY:
        return jsonify({
            "error": "Forms app integration not configured. "
                     "Set FORMS_APP_URL and INTERNAL_API_KEY env vars."
        }), 503
    if not properties_configured():
        return jsonify({"error": "Properties DB not configured for field execs."}), 503

    # 2. Parse body
    data = request.get_json(silent=True) or {}
    schedule_date = to_str(data.get("schedule_date"))
    schedule_time = to_str(data.get("schedule_time"))
    items_raw = data.get("items")

    body_errors = []

    # Date validation (mirrors single endpoint)
    if not schedule_date or not re.match(r"^\d{4}-\d{2}-\d{2}$", schedule_date):
        body_errors.append("schedule_date must be YYYY-MM-DD")
    else:
        try:
            sched_date_obj = datetime.strptime(schedule_date, "%Y-%m-%d").date()
            if sched_date_obj < datetime.now().date():
                body_errors.append("schedule_date cannot be in the past")
        except ValueError:
            body_errors.append("schedule_date is not a valid date")

    # Top-level schedule_time is OPTIONAL — used as a fallback for items that
    # omit their own. If present, validate + zero-pad.
    def _normalize_time(raw):
        """Returns (normalized_hhmm, error_message_or_None)."""
        if not raw:
            return None, "schedule_time is required"
        m = re.match(r"^(\d{1,2}):(\d{2})$", raw)
        if not m:
            return None, "schedule_time must be HH:MM (24-hr)"
        hh = int(m.group(1)); mm = int(m.group(2))
        if hh < 0 or hh > 23 or mm < 0 or mm > 59:
            return None, "schedule_time has out-of-range values"
        return f"{hh:02d}:{mm:02d}", None

    if schedule_time:
        normalized_top, err = _normalize_time(schedule_time)
        if err:
            body_errors.append(f"top-level {err}")
        else:
            schedule_time = normalized_top
    else:
        schedule_time = None  # no fallback — items must each provide their own

    # Items validation
    if not isinstance(items_raw, list) or not items_raw:
        body_errors.append("items must be a non-empty array")
    elif len(items_raw) > BULK_SCHEDULE_VISIT_MAX_ITEMS:
        body_errors.append(
            f"items cap is {BULK_SCHEDULE_VISIT_MAX_ITEMS} per request "
            f"(got {len(items_raw)})"
        )
    else:
        for i, it in enumerate(items_raw):
            if not isinstance(it, dict):
                body_errors.append(f"items[{i}] must be an object with id, field_exec_id, schedule_time")
                continue
            if not to_int(it.get("id")):
                body_errors.append(f"items[{i}].id is required")
            if not to_int(it.get("field_exec_id")):
                body_errors.append(f"items[{i}].field_exec_id is required")
            # Per-item schedule_time check: must be present (or top-level
            # fallback must exist).
            t_raw = to_str(it.get("schedule_time"))
            if t_raw:
                _, t_err = _normalize_time(t_raw)
                if t_err:
                    body_errors.append(f"items[{i}].{t_err}")
            elif not schedule_time:
                body_errors.append(
                    f"items[{i}].schedule_time is required (no top-level fallback provided)"
                )

    if body_errors:
        return jsonify({"error": "Invalid request", "details": body_errors}), 400

    # Normalize + dedupe by submission id (preserve first-seen order).
    # Each entry is (sid, field_exec_id, schedule_time).
    item_specs = []
    seen_ids = set()
    for it in items_raw:
        sid = to_int(it["id"])
        fx = to_int(it["field_exec_id"])
        t_raw = to_str(it.get("schedule_time"))
        if t_raw:
            t_norm, _ = _normalize_time(t_raw)
        else:
            t_norm = schedule_time  # top-level fallback
        if sid in seen_ids:
            continue
        seen_ids.add(sid)
        item_specs.append({"sid": sid, "field_exec_id": fx, "schedule_time": t_norm})

    submission_ids = [it["sid"] for it in item_specs]
    field_exec_ids = list({it["field_exec_id"] for it in item_specs})

    # 3. Resolve admin name once (Forms app validates assigned_by per call,
    # but the value is the same for the whole batch).
    admin_phone = g.user.get("phone") or ""
    admin_name = _resolve_admin_name_for_forms(admin_phone)
    if not admin_name:
        return jsonify({
            "error": (
                f"Cannot schedule visits — your account ({admin_phone}) is not registered "
                f"as an active user in the Forms app. Add this user to properties.users "
                f"with is_active=TRUE, then try again."
            ),
        }), 400

    # 4. Bulk-load submissions
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT s.*, c.name AS city,
                       cp.name AS cp_name, cp.phone AS cp_phone
                FROM submissions s
                LEFT JOIN cities c ON c.id = s.city_id
                LEFT JOIN channel_partners cp ON cp.id = s.cp_id
                WHERE s.id = ANY(%s) AND s.deleted_at IS NULL
            """, (submission_ids,))
            sub_rows = cur.fetchall()
    finally:
        put_app_conn(conn)

    sub_by_id = {r["id"]: r for r in sub_rows}

    # 5. Bulk-load field execs (must be can_visit + is_active per spec)
    pconn = get_props_conn()
    try:
        with pconn.cursor() as cur:
            cur.execute("""
                SELECT id, name FROM users
                WHERE id = ANY(%s) AND can_visit = TRUE AND is_active = TRUE
            """, (field_exec_ids,))
            exec_rows = cur.fetchall()
    finally:
        put_props_conn(pconn)

    exec_by_id = {r["id"]: r for r in exec_rows}

    # 6. Phase 1 — pre-validate every item
    ALLOWED_FORMS_CITIES = {"Gurgaon", "Noida", "Ghaziabad"}
    preflight_errors = []
    ready_items = []        # validated, ready for Forms POST
    already_scheduled = []  # idempotency: rows with forms_uid already set

    for spec in item_specs:
        sid = spec["sid"]
        field_exec_id = spec["field_exec_id"]
        item_time = spec["schedule_time"]
        sub = sub_by_id.get(sid)
        if not sub:
            preflight_errors.append({
                "id": sid,
                "errors": [{"label": "Submission not found or deleted"}],
            })
            continue

        # Idempotent skip: already scheduled rows aren't a pre-flight error,
        # they're just reported as already_existed in the final result.
        if sub.get("forms_uid"):
            already_scheduled.append({
                "id": sid,
                "public_id": sub.get("public_id"),
                "ok": True,
                "uid": sub["forms_uid"],
                "already_existed": True,
                "scheduled_date": (
                    sub.get("scheduled_date").isoformat()
                    if sub.get("scheduled_date") else schedule_date
                ),
                "scheduled_time": sub.get("scheduled_time") or item_time,
                "field_exec_name": sub.get("field_exec_name"),
            })
            continue

        item_errors = []

        # Required submission fields
        for field, label in SCHEDULE_REQUIRED_SUBMISSION_FIELDS:
            val = sub.get(field)
            if val is None or (isinstance(val, str) and not val.strip()) or val == 0:
                item_errors.append({"field": field, "label": label})

        # City whitelist (case-insensitive)
        raw_city = (sub.get("city") or "").strip()
        city_match = next(
            (c for c in ALLOWED_FORMS_CITIES if raw_city.lower() == c.lower()),
            None,
        )
        if not city_match:
            item_errors.append({
                "field": "city",
                "label": (
                    f"City '{raw_city}' is not supported by the Forms app. "
                    f"Allowed: {', '.join(sorted(ALLOWED_FORMS_CITIES))}."
                ),
            })

        # Field exec authorization
        exec_row = exec_by_id.get(field_exec_id)
        if not exec_row:
            item_errors.append({
                "field": "field_exec_id",
                "label": f"Field exec id={field_exec_id} not found or not authorized.",
            })

        # CP info → owner_broker_name + contact_no
        cp_name = (sub.get("cp_name") or "").strip()
        if not cp_name:
            item_errors.append({"field": "cp_name", "label": "CP name is missing."})
        cp_phone_10 = _normalize_phone_to_10_digits(sub.get("cp_phone") or "")
        if len(cp_phone_10) != 10 or cp_phone_10.startswith("0"):
            item_errors.append({
                "field": "cp_phone",
                "label": "CP phone is not a valid 10-digit number.",
            })

        # Numeric fields
        area_sqft = int(sub.get("sqft") or 0)
        if area_sqft <= 0:
            item_errors.append({"field": "sqft", "label": "Area (sqft) must be > 0."})

        demand_price_lakhs = _rupees_to_lakhs_int(sub.get("asking_price"))
        if demand_price_lakhs is None or demand_price_lakhs <= 0:
            item_errors.append({
                "field": "asking_price",
                "label": "Asking price is invalid.",
            })

        if item_errors:
            preflight_errors.append({
                "id": sid,
                "public_id": sub.get("public_id"),
                "errors": item_errors,
            })
            continue

        # All clear — collect into ready_items for Phase 2
        first_name, last_name = _split_full_name(cp_name)
        ready_items.append({
            "sid": sid,
            "sub": sub,
            "field_exec_id": field_exec_id,
            "field_exec_name": exec_row["name"],
            "schedule_time": item_time,
            "city": city_match,
            "cp_name": cp_name,
            "first_name": first_name,
            "last_name": last_name,
            "cp_phone_10": cp_phone_10,
            "area_sqft": area_sqft,
            "demand_price_lakhs": demand_price_lakhs,
        })

    # Per Q3=a: any pre-flight error aborts the entire batch.
    if preflight_errors:
        return jsonify({
            "error": (
                "Pre-validation failed for one or more listings. "
                "No requests were sent to the Forms app."
            ),
            "preflight_errors": preflight_errors,
        }), 400

    # 7. Resolve localities (one query per unique (society, city) pair)
    locality_pairs = list({
        (r["sub"].get("society_name") or "", r["city"]) for r in ready_items
    })
    locality_lookup = {}
    if locality_pairs:
        pconn2 = get_props_conn()
        try:
            with pconn2.cursor() as cur:
                for soc, city in locality_pairs:
                    if not soc:
                        locality_lookup[(soc, city)] = "Unknown"
                        continue
                    cur.execute("""
                        SELECT locality FROM master_societies
                        WHERE LOWER(REGEXP_REPLACE(society_name, '[^a-zA-Z0-9]', '', 'g'))
                              = LOWER(REGEXP_REPLACE(%s, '[^a-zA-Z0-9]', '', 'g'))
                          AND LOWER(TRIM(city)) = LOWER(%s)
                        LIMIT 1
                    """, (soc, city))
                    row = cur.fetchone()
                    if row and (row.get("locality") or "").strip():
                        locality_lookup[(soc, city)] = row["locality"].strip()
                    else:
                        log.warning(
                            "[bulk_schedule_visit] No locality match for society=%r city=%s — using society_name as fallback",
                            soc, city,
                        )
                        locality_lookup[(soc, city)] = soc or "Unknown"
        finally:
            put_props_conn(pconn2)

    # 8. Phase 2 — Sequential Forms-app POSTs (best-effort per item)
    forms_url = Config.FORMS_APP_URL.rstrip("/") + "/api/external/schedule"
    headers = {
        "X-Internal-Key": Config.INTERNAL_API_KEY,
        "Content-Type": "application/json",
    }

    successes = []          # rows to UPDATE in Phase 3
    new_results = []        # per-item Phase 2 results

    for r in ready_items:
        sub = r["sub"]
        sid = r["sid"]
        locality = locality_lookup.get(
            (sub.get("society_name") or "", r["city"]),
            sub.get("society_name") or "Unknown",
        )
        lead_id = sub.get("public_id") or str(sid)

        payload = {
            "lead_id": lead_id,
            "society_name": sub.get("society_name") or "",
            "locality": locality,
            "city": r["city"],
            "tower_no": sub.get("tower") or "",
            "unit_no": sub.get("unit_no") or "",
            "owner_broker_name": r["cp_name"],
            "first_name": r["first_name"],
            "last_name": r["last_name"],
            "contact_no": r["cp_phone_10"],
            "configuration": _normalize_bhk_for_forms(sub.get("bhk")),
            "area_sqft": r["area_sqft"],
            "demand_price": r["demand_price_lakhs"],
            "source": "CP",
            "field_exec": r["field_exec_name"],
            "assigned_by": admin_name,
            "schedule_date": schedule_date,
            "schedule_time": r["schedule_time"],
        }

        try:
            resp = requests.post(
                forms_url,
                json=payload,
                headers=headers,
                timeout=Config.FORMS_APP_TIMEOUT_SECONDS,
            )
        except requests.exceptions.Timeout:
            log.error("[bulk_schedule_visit] Forms app timeout sid=%s", sid)
            new_results.append({
                "id": sid,
                "public_id": sub.get("public_id"),
                "ok": False,
                "error": "Forms app did not respond in time.",
            })
            continue
        except requests.exceptions.RequestException as e:
            log.error("[bulk_schedule_visit] Forms app network error sid=%s: %s", sid, e)
            new_results.append({
                "id": sid,
                "public_id": sub.get("public_id"),
                "ok": False,
                "error": f"Could not reach Forms app: {e}",
            })
            continue

        try:
            result = resp.json()
        except ValueError:
            result = {}

        if resp.status_code >= 400 or not result.get("success"):
            log.warning(
                "[bulk_schedule_visit] Forms app returned %s sid=%s body=%s",
                resp.status_code, sid, resp.text[:500],
            )
            new_results.append({
                "id": sid,
                "public_id": sub.get("public_id"),
                "ok": False,
                "error": result.get("error") or f"Forms app error (HTTP {resp.status_code})",
            })
            continue

        forms_uid = result.get("uid")
        already_existed = bool(result.get("already_existed"))
        if not forms_uid:
            new_results.append({
                "id": sid,
                "public_id": sub.get("public_id"),
                "ok": False,
                "error": "Forms app did not return a UID.",
            })
            continue

        successes.append({
            "sid": sid,
            "uid": forms_uid,
            "already_existed": already_existed,
            "field_exec_name": r["field_exec_name"],
            "schedule_time": r["schedule_time"],
        })
        new_results.append({
            "id": sid,
            "public_id": sub.get("public_id"),
            "ok": True,
            "uid": forms_uid,
            "already_existed": already_existed,
            "scheduled_date": schedule_date,
            "scheduled_time": r["schedule_time"],
            "field_exec_name": r["field_exec_name"],
        })

    # 9. Phase 3 — persist Phase 2 successes in one transaction
    if successes:
        conn = get_app_conn()
        try:
            with conn.cursor() as cur:
                for s in successes:
                    cur.execute("""
                        UPDATE submissions
                        SET forms_uid       = %s,
                            scheduled_date  = %s,
                            scheduled_time  = %s,
                            field_exec_name = %s
                        WHERE id = %s
                    """, (s["uid"], schedule_date, s["schedule_time"], s["field_exec_name"], s["sid"]))
                    cur.execute("""
                        INSERT INTO submission_events
                            (submission_id, actor_cp_id, kind, text)
                        VALUES (%s, %s, 'system', %s)
                    """, (
                        s["sid"],
                        g.user.get("cp_id"),  # NULL for admins/RMs/managers
                        f"Visit scheduled (bulk) for {schedule_date} {s['schedule_time']} "
                        f"with {s['field_exec_name']}. Forms UID: {s['uid']}"
                        f"{' (already existed)' if s['already_existed'] else ''}",
                    ))
                conn.commit()
        finally:
            put_app_conn(conn)

    results = already_scheduled + new_results
    summary = {
        "total": len(item_specs),
        "succeeded": sum(1 for r in results if r["ok"]),
        "failed": sum(1 for r in results if not r["ok"]),
        "already_scheduled": len(already_scheduled),
    }
    return jsonify({
        "ok": summary["failed"] == 0,
        "results": results,
        "summary": summary,
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
    Body: { "ids": [1, 2, 3], "status": "Visit Scheduled" }
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


# ============================================================
# Add Inventory on Behalf of CP (RM/Manager/Admin)
# ============================================================
#
# RMs typically receive listing details from a CP over phone/WhatsApp and
# enter them into the system on behalf of the CP. This block adds:
#
#   1. GET  /api/admin/cps?q=<query>           — CP search (scope-filtered)
#   2. POST /api/admin/submissions/on-behalf   — create a submission on
#                                                 behalf of a target CP
#
# Storage: submissions.submitted_by_name (TEXT, nullable) captures the
# staff member's display name at submission time. NULL means the CP
# submitted directly.
# ============================================================


def _scoped_cp_filter():
    """Scope filter for queries directly on `channel_partners cp` (NOT via
    submissions). Returns (sql_fragment, params).

    Mirrors _scoped_city_filter but operates on the cp alias directly.
      - admin: no restriction.
      - manager: cp.rm_id = me OR cp.rm_id IN my team.
      - rm:      cp.rm_id = me.
      - else:    deny by default.
    """
    role = g.user.get("role", "cp")
    if role == "admin":
        return "", []

    rm_id = g.user.get("rm_id")
    is_manager = bool(g.user.get("is_manager"))

    if rm_id:
        if is_manager:
            return (
                "AND (cp.rm_id = %s "
                "OR cp.rm_id IN (SELECT id FROM rms WHERE manager_id = %s))"
            ), [rm_id, rm_id]
        return "AND cp.rm_id = %s", [rm_id]

    return "AND FALSE", []


def _resolve_staff_display_name() -> str:
    """Look up the calling staff member's display name from the canonical
    table (channel_partners for admin, rms for rm/manager). Used to
    capture submissions.submitted_by_name for on-behalf submissions.

    Falls back to the JWT 'name' field (or 'Unknown staff') if the lookup
    fails — we never want a submission insert to break because we can't
    resolve a name.
    """
    role = g.user.get("role")
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            if role == "admin":
                cp_id = g.user.get("cp_id")
                if cp_id:
                    cur.execute("SELECT name FROM channel_partners WHERE id = %s", (cp_id,))
                    row = cur.fetchone()
                    if row and (row.get("name") or "").strip():
                        return row["name"].strip()
            elif role in ("rm", "manager"):
                rm_id = g.user.get("rm_id")
                if rm_id:
                    cur.execute("SELECT name FROM rms WHERE id = %s", (rm_id,))
                    row = cur.fetchone()
                    if row and (row.get("name") or "").strip():
                        return row["name"].strip()
    finally:
        put_app_conn(conn)
    return (g.user.get("name") or "Unknown staff").strip()


@bp.get("/cps")
@require_staff
def search_cps():
    """Scope-filtered CP search for the on-behalf flow.

    Query string:
      q     — substring of name OR phone (digits-only). REQUIRED, min 2 chars.
      limit — max results (default 20, capped at 50).

    Returns: { results: [{id, cp_code, name, phone, company, city}, ...] }
    Phone matching is digits-only on both sides, so '971' matches '9711382053'.
    Name matching is case-insensitive substring.
    """
    q = to_str(request.args.get("q") or "").strip()
    limit = max(1, min(50, request.args.get("limit", default=20, type=int) or 20))

    if len(q) < 2:
        return jsonify({"results": []}), 200

    q_digits = re.sub(r"\D", "", q)

    scope_sql, scope_params = _scoped_cp_filter()

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            sql_parts = [
                "SELECT cp.id, cp.cp_code, cp.name, cp.phone, cp.company, c.name AS city",
                "FROM channel_partners cp",
                "LEFT JOIN cities c ON cp.city_id = c.id",
                "WHERE cp.is_active = TRUE",
                "AND COALESCE(cp.is_admin, FALSE) = FALSE",  # exclude admin accounts
            ]
            params = []

            # Build the OR clause for q matching
            or_clauses = []
            if q_digits and len(q_digits) >= 3:
                # Match phone with non-digits stripped on both sides
                or_clauses.append("REGEXP_REPLACE(COALESCE(cp.phone, ''), '\\D', '', 'g') LIKE %s")
                params.append(f"%{q_digits}%")
            or_clauses.append("LOWER(cp.name) LIKE LOWER(%s)")
            params.append(f"%{q}%")
            sql_parts.append(f"AND ({' OR '.join(or_clauses)})")

            if scope_sql:
                sql_parts.append(scope_sql)
                params.extend(scope_params)

            sql_parts.append("ORDER BY cp.name ASC NULLS LAST, cp.id ASC")
            sql_parts.append("LIMIT %s")
            params.append(limit)

            cur.execute("\n".join(sql_parts), params)
            results = cur.fetchall()
    finally:
        put_app_conn(conn)

    return jsonify({"results": results}), 200


@bp.post("/submissions/on-behalf")
@require_staff
def create_submission_on_behalf():
    """Create a submission on behalf of a target CP.

    Mirrors POST /api/submissions (CP-side) but with:
      - target_cp_id required in body; staff must have it in scope.
      - cp_id on the inserted row = target_cp_id (not the staff member).
      - submitted_by_name = staff display name (for audit + UI display).
      - submission_event text annotates "submitted by <staff> on behalf of CP <cp>".

    Same dup-check + status routing as the CP flow:
      - perfect match  -> Duplicate Rejected (returns 409 + duplicate dict)
      - unit_less + collated/submissions match -> Unapproved + show_contact_rm_page
      - clean / force_create on weak dup       -> Submitted (or Unapproved if force on dup)
    """
    # Lazy imports to avoid circular import with routes/submissions.py at module load
    from duplicate_check import check_duplicate
    from public_id import generate_public_id, city_to_prefix
    from services_email import send_new_submission_alert_async

    data = request.get_json(silent=True) or {}

    target_cp_id = to_int(data.get("target_cp_id"))
    if not target_cp_id:
        return jsonify({"error": "target_cp_id is required"}), 400

    society_id = data.get("society_id")
    society_name = to_str(data.get("society_name"), 200)
    if not society_id or not society_name:
        return jsonify({"error": "society_id and society_name are required"}), 400

    # 1. Load + scope-check the target CP
    scope_sql, scope_params = _scoped_cp_filter()
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT cp.id, cp.name, cp.phone, cp.cp_code,
                       cp.is_active, COALESCE(cp.is_admin, FALSE) AS is_admin
                FROM channel_partners cp
                WHERE cp.id = %s {scope_sql}
            """, [target_cp_id, *scope_params])
            cp_row = cur.fetchone()
            if not cp_row:
                return jsonify({
                    "error": "Target CP not found or not in your scope.",
                }), 403
            if not cp_row.get("is_active"):
                return jsonify({
                    "error": "Target CP is inactive. Cannot submit on their behalf.",
                }), 400
            if cp_row.get("is_admin"):
                return jsonify({
                    "error": "Target is an admin account, not a CP.",
                }), 400

            # 2. Resolve society + city
            cur.execute("""
                SELECT s.city_id, c.name AS city_name
                FROM societies s
                JOIN cities c ON s.city_id = c.id
                WHERE s.id = %s
            """, (society_id,))
            soc_row = cur.fetchone()
            if not soc_row:
                return jsonify({"error": "Invalid society_id"}), 400
            society_city_id = soc_row["city_id"]
            city_name = soc_row["city_name"]
    finally:
        put_app_conn(conn)

    if city_to_prefix(city_name) is None:
        return jsonify({
            "error": f"City {city_name!r} does not have a public_id prefix configured.",
        }), 500

    # 3. Dup-check (uses target CP's id so RM info is resolved correctly)
    skip_unit_details = bool(data.get("skip_unit_details"))
    dup = check_duplicate(
        society_id=society_id,
        bhk=to_str(data.get("bhk")),
        tower=None if skip_unit_details else to_str(data.get("tower")),
        unit_no=None if skip_unit_details else to_str(data.get("unit_no")),
        floor=to_str(data.get("floor")),
        cp_id=target_cp_id,
    )

    is_perfect_match = (
        not skip_unit_details
        and dup.get("match_level") == "exact"
        and bool(dup.get("block"))
    )
    is_unit_less = skip_unit_details
    has_collated_match = bool(dup.get("collated_match"))
    has_submissions_match = bool(dup.get("submissions_match"))
    force_create = bool(data.get("force_create"))

    if is_perfect_match:
        initial_status = "Duplicate Rejected"
    elif is_unit_less:
        initial_status = (
            "Unapproved"
            if (has_collated_match or has_submissions_match)
            else "Submitted"
        )
    else:
        initial_status = "Unapproved" if (dup.get("block") and force_create) else "Submitted"

    collated_match = has_collated_match and initial_status == "Unapproved"
    submissions_match = has_submissions_match and initial_status == "Unapproved"

    staff_name = _resolve_staff_display_name()
    target_cp_name = (cp_row.get("name") or f"CP #{target_cp_id}").strip()

    log.info(
        "[submission/on-behalf] staff=%r target_cp_id=%s society=%r bhk=%r floor=%r "
        "skip_unit=%s perfect=%s collated=%s submissions=%s force_create=%s -> status=%s",
        staff_name, target_cp_id, society_name, data.get("bhk"), data.get("floor"),
        skip_unit_details, is_perfect_match, has_collated_match, has_submissions_match,
        force_create, initial_status,
    )

    # 4. Insert + event in one transaction
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            public_id = generate_public_id(cur, city_name)

            cur.execute("""
                INSERT INTO submissions (
                    cp_id, society_id, society_name, city_id, public_id,
                    tower, unit_no, floor, sqft, bhk, furnishing,
                    exit_facing, balcony_facing, balcony_view,
                    parking, extra_rooms, occupancy_status,
                    asking_price, seller_name, seller_phone, photos,
                    status, collated_match, submissions_match,
                    unit_less, perfect_match_at_submit,
                    submitted_by_name
                ) VALUES (
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s,
                    %s, %s, %s,
                    %s, %s::jsonb, %s,
                    %s, %s, %s, %s::jsonb,
                    %s, %s, %s,
                    %s, %s,
                    %s
                )
                RETURNING id
            """, (
                target_cp_id,
                society_id,
                society_name,
                society_city_id,
                public_id,
                to_str(data.get("tower"), 50),
                to_str(data.get("unit_no"), 50),
                to_str(data.get("floor"), 20),
                to_int(data.get("sqft")),
                to_str(data.get("bhk"), 20),
                to_str(data.get("furnishing"), 50),
                to_str(data.get("exit_facing"), 50),
                to_str(data.get("balcony_facing"), 50),
                to_str(data.get("balcony_view"), 100),
                to_str(data.get("parking"), 50),
                json.dumps(data.get("extra_rooms") or []),
                to_str(data.get("occupancy_status"), 20),
                to_int(data.get("asking_price")),
                to_str(data.get("seller_name"), 200),
                to_str(data.get("seller_phone"), 20),
                json.dumps(data.get("photos") or []),
                initial_status,
                collated_match,
                submissions_match,
                is_unit_less,
                is_perfect_match,
                staff_name,
            ))
            new_id = cur.fetchone()["id"]

            base_text = (
                "Unit flagged as duplicate — pending admin review"
                if initial_status == "Unapproved"
                else "Unit submitted"
            )
            event_text = (
                f"{base_text} (submitted by {staff_name} on behalf of CP {target_cp_name})"
            )
            cur.execute("""
                INSERT INTO submission_events
                    (submission_id, actor_cp_id, kind, to_status, text)
                VALUES (%s, %s, 'system', %s, %s)
            """, (new_id, target_cp_id, initial_status, event_text))

            conn.commit()
    finally:
        put_app_conn(conn)

    if initial_status == "Submitted":
        send_new_submission_alert_async(new_id)

    if is_perfect_match:
        return jsonify({
            "error": "Duplicate",
            "duplicate": dup,
            "submission_id": new_id,
            "public_id": public_id,
        }), 409

    if is_unit_less and (has_collated_match or has_submissions_match):
        message = "Unit submitted for admin review"
    elif is_unit_less:
        message = "Unit submitted for evaluation"
    elif initial_status == "Unapproved":
        message = "Unit submitted for admin review"
    else:
        message = "Unit submitted for evaluation"

    show_contact_rm_page = is_unit_less and (has_collated_match or has_submissions_match)
    duplicate_payload = None
    if show_contact_rm_page:
        custom_message = (
            f"We already have a similar listing for {society_name} "
            f"({to_str(data.get('bhk')) or 'BHK'}, floor {to_str(data.get('floor')) or '—'}). "
            f"This unit will be reviewed and an update given in the next 48 hours."
        )
        duplicate_payload = {
            **dup,
            "message": custom_message,
            "unit_less_collated": True,
        }

    return jsonify({
        "success": True,
        "submission_id": new_id,
        "public_id": public_id,
        "status": initial_status,
        "unit_less": is_unit_less,
        "message": message,
        "submitted_by_name": staff_name,
        "target_cp_name": target_cp_name,
        "show_contact_rm_page": show_contact_rm_page,
        "duplicate": duplicate_payload,
    }), 201


# ============================================================
# Bulk reassign CPs to a different RM (admin-only)
# ============================================================
#
# Re-routes the channel_partners.rm_id for a batch of CPs in one call.
# This is the "permanent" RM relationship — every listing owned by these
# CPs (past and future) will now appear under the new RM's scope.
#
# Operates on CP IDs (not submission IDs) because rm_id lives on
# channel_partners. The frontend collects unique cp_ids from the
# selected submissions and shows the per-CP impact in a confirm modal
# before calling this.
# ============================================================


@bp.post("/cps/bulk-reassign-rm")
@require_staff
@require_admin_role  # admin only — affects the canonical CP-RM ownership
def bulk_reassign_rm():
    """Reassign a batch of CPs to a different RM.

    Body:
      {
        "cp_ids": [int, int, ...],   # required, non-empty, max 100
        "target_rm_id": int          # required; must exist and be active
      }

    Behavior:
      - Validates target_rm_id exists in `rms` and is_active=TRUE.
      - Validates every cp_id exists in `channel_partners` (no scope check
        because admin only). Inactive CPs are accepted but flagged in the
        response so the admin can see what they did.
      - Updates rm_id on every cp atomically (single UPDATE with ANY).
      - Returns counts + list of updated CP ids.
    """
    data = request.get_json(silent=True) or {}
    cp_ids_raw = data.get("cp_ids") or []
    target_rm_id = to_int(data.get("target_rm_id"))

    if not isinstance(cp_ids_raw, list) or not cp_ids_raw:
        return jsonify({"error": "cp_ids must be a non-empty array"}), 400
    if len(cp_ids_raw) > 100:
        return jsonify({"error": "cp_ids cap is 100 per request"}), 400
    if not target_rm_id:
        return jsonify({"error": "target_rm_id is required"}), 400

    # Dedupe + coerce to int
    cp_ids = []
    seen = set()
    for x in cp_ids_raw:
        v = to_int(x)
        if v and v not in seen:
            seen.add(v)
            cp_ids.append(v)
    if not cp_ids:
        return jsonify({"error": "cp_ids contains no valid integers"}), 400

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            # 1. Verify target RM
            cur.execute(
                "SELECT id, name, is_active FROM rms WHERE id = %s",
                (target_rm_id,),
            )
            rm_row = cur.fetchone()
            if not rm_row:
                return jsonify({"error": f"RM id={target_rm_id} not found"}), 404
            if not rm_row.get("is_active"):
                return jsonify({"error": f"RM id={target_rm_id} ({rm_row.get('name')}) is inactive"}), 400
            target_rm_name = rm_row["name"]

            # 2. Load existing CPs to report per-CP outcome
            cur.execute("""
                SELECT id, name, cp_code, phone, rm_id, is_active
                FROM channel_partners
                WHERE id = ANY(%s)
            """, (cp_ids,))
            existing = cur.fetchall()
            existing_by_id = {r["id"]: r for r in existing}

            results = []
            updated_ids = []
            for cid in cp_ids:
                row = existing_by_id.get(cid)
                if not row:
                    results.append({"cp_id": cid, "ok": False, "error": "CP not found"})
                    continue
                if row["rm_id"] == target_rm_id:
                    results.append({
                        "cp_id": cid, "ok": True, "skipped": True,
                        "name": row.get("name"), "cp_code": row.get("cp_code"),
                        "previous_rm_id": row["rm_id"],
                        "note": "Already on this RM — no change",
                    })
                    continue
                results.append({
                    "cp_id": cid, "ok": True,
                    "name": row.get("name"), "cp_code": row.get("cp_code"),
                    "previous_rm_id": row["rm_id"],
                    "is_active": bool(row.get("is_active")),
                })
                updated_ids.append(cid)

            # 3. Single UPDATE for all CPs that need a real change
            if updated_ids:
                cur.execute(
                    "UPDATE channel_partners SET rm_id = %s WHERE id = ANY(%s)",
                    (target_rm_id, updated_ids),
                )
                conn.commit()
    finally:
        put_app_conn(conn)

    log.info(
        "[bulk_reassign_rm] admin=%s target_rm=%s (%s) reassigned=%d skipped=%d not_found=%d",
        g.user.get("phone"), target_rm_id, target_rm_name,
        len(updated_ids),
        sum(1 for r in results if r.get("skipped")),
        sum(1 for r in results if not r.get("ok")),
    )

    return jsonify({
        "ok": True,
        "target_rm_id": target_rm_id,
        "target_rm_name": target_rm_name,
        "reassigned_count": len(updated_ids),
        "skipped_already_on_rm": sum(1 for r in results if r.get("skipped")),
        "not_found": sum(1 for r in results if not r.get("ok")),
        "results": results,
    }), 200


# ============================================================
# Per-listing RM override (vs the CP-permanent rm_id on channel_partners)
# ============================================================
#
# Sets `submissions.listing_rm_id` (FK -> rms). NULL = no override; the
# effective RM falls back to channel_partners.rm_id.
#
# Migration: backend/migrations/2026-04-30-add-listing-rm-id.sql
# ============================================================


def _validate_target_rm(cur, target_rm_id):
    """Returns (rm_name, error_response_tuple_or_None).

    target_rm_id may be None (clear the override) or an int.
    On error returns (None, (json_dict, status_code)) so caller can early-exit.
    """
    if target_rm_id is None:
        return None, None
    cur.execute("SELECT id, name, is_active FROM rms WHERE id = %s", (target_rm_id,))
    rm = cur.fetchone()
    if not rm:
        return None, ({"error": f"RM id={target_rm_id} not found"}, 404)
    if not rm.get("is_active"):
        return None, ({"error": f"RM id={target_rm_id} ({rm.get('name')}) is inactive"}, 400)
    return rm["name"], None


@bp.patch("/submissions/<int:sid>/listing-rm")
@require_staff
@require_admin_role  # admin only — same gate as the CP-permanent reassign
def set_listing_rm(sid: int):
    """Set or clear the per-listing RM override for a single submission.

    Body:
      { "target_rm_id": int | null }   # null clears the override

    Effect:
      submissions.listing_rm_id := target_rm_id (NULL clears).
      The CP's permanent rm_id on channel_partners is NOT touched.
      Effective RM falls back to channel_partners.rm_id when listing_rm_id is NULL.
    """
    data = request.get_json(silent=True) or {}
    raw = data.get("target_rm_id", "__missing__")
    if raw == "__missing__":
        return jsonify({"error": "target_rm_id is required (use null to clear)"}), 400
    target_rm_id = None if raw is None else to_int(raw)
    if raw is not None and not target_rm_id:
        return jsonify({"error": "target_rm_id must be an integer or null"}), 400

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            rm_name, err = _validate_target_rm(cur, target_rm_id)
            if err:
                body, status = err
                return jsonify(body), status

            cur.execute(
                "SELECT id, listing_rm_id FROM submissions WHERE id = %s AND deleted_at IS NULL",
                (sid,),
            )
            sub = cur.fetchone()
            if not sub:
                return jsonify({"error": "Submission not found or deleted"}), 404
            if sub["listing_rm_id"] == target_rm_id:
                return jsonify({
                    "ok": True, "unchanged": True,
                    "listing_rm_id": target_rm_id, "listing_rm_name": rm_name,
                }), 200

            cur.execute(
                "UPDATE submissions SET listing_rm_id = %s WHERE id = %s",
                (target_rm_id, sid),
            )
            event_text = (
                f"Listing RM override set to {rm_name}"
                if target_rm_id is not None
                else "Listing RM override cleared (CP's permanent RM applies)"
            )
            cur.execute("""
                INSERT INTO submission_events (submission_id, actor_cp_id, kind, text)
                VALUES (%s, %s, 'system', %s)
            """, (sid, g.user.get("cp_id"), event_text))
            conn.commit()
    finally:
        put_app_conn(conn)

    return jsonify({
        "ok": True,
        "submission_id": sid,
        "listing_rm_id": target_rm_id,
        "listing_rm_name": rm_name,
    }), 200


@bp.post("/submissions/bulk-reassign-listing-rm")
@require_staff
@require_admin_role
def bulk_reassign_listing_rm():
    """Set or clear the per-listing RM override for many submissions in one call.

    Body:
      {
        "submission_ids": [int],   # required, non-empty, max 100
        "target_rm_id":   int | null  # null clears
      }

    Idempotent on already-target rows; returns updated count.
    """
    data = request.get_json(silent=True) or {}
    submission_ids_raw = data.get("submission_ids") or []
    raw = data.get("target_rm_id", "__missing__")
    if raw == "__missing__":
        return jsonify({"error": "target_rm_id is required (use null to clear)"}), 400
    target_rm_id = None if raw is None else to_int(raw)
    if raw is not None and not target_rm_id:
        return jsonify({"error": "target_rm_id must be int or null"}), 400

    if not isinstance(submission_ids_raw, list) or not submission_ids_raw:
        return jsonify({"error": "submission_ids must be a non-empty array"}), 400
    if len(submission_ids_raw) > 100:
        return jsonify({"error": "submission_ids cap is 100 per request"}), 400

    seen = set()
    submission_ids = []
    for x in submission_ids_raw:
        v = to_int(x)
        if v and v not in seen:
            seen.add(v)
            submission_ids.append(v)
    if not submission_ids:
        return jsonify({"error": "submission_ids contains no valid integers"}), 400

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            target_rm_name, err = _validate_target_rm(cur, target_rm_id)
            if err:
                body, status = err
                return jsonify(body), status

            cur.execute("""
                UPDATE submissions
                SET listing_rm_id = %s
                WHERE id = ANY(%s) AND deleted_at IS NULL
                  AND COALESCE(listing_rm_id, -1) IS DISTINCT FROM COALESCE(%s, -1)
                RETURNING id
            """, (target_rm_id, submission_ids, target_rm_id))
            updated = cur.fetchall()
            updated_ids = [r["id"] for r in updated]

            event_text = (
                f"Listing RM override set to {target_rm_name} (bulk)"
                if target_rm_id is not None
                else "Listing RM override cleared (bulk)"
            )
            for sid in updated_ids:
                cur.execute("""
                    INSERT INTO submission_events (submission_id, actor_cp_id, kind, text)
                    VALUES (%s, %s, 'system', %s)
                """, (sid, g.user.get("cp_id"), event_text))
            conn.commit()
    finally:
        put_app_conn(conn)

    log.info(
        "[bulk_reassign_listing_rm] target_rm=%s n_updated=%d (of %d requested)",
        target_rm_id, len(updated_ids), len(submission_ids),
    )

    return jsonify({
        "ok": True,
        "target_rm_id": target_rm_id,
        "target_rm_name": target_rm_name,
        "updated_count": len(updated_ids),
        "skipped_already_on_rm": len(submission_ids) - len(updated_ids),
        "submission_ids": updated_ids,
    }), 200


# ============================================================
# External inventory view: collated_data (App DB) + properties (Properties DB)
# ============================================================
#
# Read-only view of inventory rows that are NOT in our submissions table.
# Merged + paginated in Python (cross-DB, can't UNION at SQL level). Used by
# the admin "External Data" page.
#
# Display labels: collated_data => "D Data"; properties => "F Data".
# ============================================================

EXTERNAL_INVENTORY_PAGE_SIZE_DEFAULT = 100
EXTERNAL_INVENTORY_PAGE_SIZE_MAX = 500


SORTABLE_COLUMNS = {
    "type":    {"is_str": True},
    "id":      {"is_str": True},
    "source":  {"is_str": True},
    "society": {"is_str": True},
    "city":    {"is_str": True},
    "bhk":     {"is_str": True},
    "floor":   {"is_str": True},   # mixed text/numeric across sources; treat as string
    "tower":   {"is_str": True},
    "unit_no": {"is_str": True},
    "area":    {"is_str": False},
    "date":    {"is_str": True},   # ISO strings sort lexicographically = chronologically
}


@bp.get("/external-inventory")
@require_staff
def list_external_inventory():
    """Merged read-only view of `collated_data` (App DB) + `properties`
    (Properties DB), normalised to a single column shape.

    Query string:
      q           substring match against society/locality/source
      city        exact-match (case-insensitive)
      source      exact-match (case-insensitive) on the row's source
      bhk         exact-match (case-insensitive) on bedrooms/configuration
      floor       exact-match string against floor (case/whitespace-insensitive)
      area_min    minimum area_sqft (inclusive)
      area_max    maximum area_sqft (inclusive)
      date_from   YYYY-MM-DD inclusive lower bound (against posting_date /
                  schedule_submitted_at)
      date_to     YYYY-MM-DD inclusive upper bound
      type        'D' | 'F' | omitted (both)
      sort        column name (see SORTABLE_COLUMNS)
      direction   'asc' | 'desc'  (default desc)
      page        1-based (default 1)
      page_size   default 100, capped at 500
    """
    args = request.args
    q       = (args.get("q") or "").strip()
    city    = (args.get("city") or "").strip() or None
    source  = (args.get("source") or "").strip() or None
    bhk     = (args.get("bhk") or "").strip() or None
    floor   = (args.get("floor") or "").strip() or None
    type_filter = (args.get("type") or "").strip().upper() or None
    if type_filter not in ("D", "F"):
        type_filter = None
    sort_col = (args.get("sort") or "date").strip().lower()
    if sort_col not in SORTABLE_COLUMNS:
        sort_col = "date"
    direction = (args.get("direction") or "desc").strip().lower()
    if direction not in ("asc", "desc"):
        direction = "desc"

    def _to_int(v):
        try: return int(v) if v not in (None, "") else None
        except (TypeError, ValueError): return None
    area_min = _to_int(args.get("area_min"))
    area_max = _to_int(args.get("area_max"))

    def _validate_date(s):
        s = (s or "").strip()
        if not s: return None
        return s if re.match(r"^\d{4}-\d{2}-\d{2}$", s) else None
    date_from = _validate_date(args.get("date_from"))
    date_to   = _validate_date(args.get("date_to"))

    try:
        page = max(1, int(args.get("page") or 1))
    except ValueError:
        page = 1
    try:
        page_size = int(args.get("page_size") or EXTERNAL_INVENTORY_PAGE_SIZE_DEFAULT)
    except ValueError:
        page_size = EXTERNAL_INVENTORY_PAGE_SIZE_DEFAULT
    page_size = max(1, min(EXTERNAL_INVENTORY_PAGE_SIZE_MAX, page_size))

    rows = []

    # ── 1) collated_data (App DB) → "D Data" ──────────────────────
    if type_filter in (None, "D"):
        conn = get_app_conn()
        try:
            with conn.cursor() as cur:
                clauses, params = [], []
                if city:
                    clauses.append("LOWER(TRIM(city)) = LOWER(TRIM(%s))")
                    params.append(city)
                if source:
                    clauses.append("LOWER(TRIM(source)) = LOWER(TRIM(%s))")
                    params.append(source)
                if bhk:
                    clauses.append("LOWER(TRIM(bedrooms)) = LOWER(TRIM(%s))")
                    params.append(bhk)
                if floor:
                    clauses.append("LOWER(TRIM(COALESCE(floor, ''))) = LOWER(TRIM(%s))")
                    params.append(floor)
                if area_min is not None:
                    clauses.append("COALESCE(area_sqft, 0) >= %s")
                    params.append(area_min)
                if area_max is not None:
                    clauses.append("COALESCE(area_sqft, 0) <= %s")
                    params.append(area_max)
                if date_from:
                    clauses.append("posting_date >= %s::date")
                    params.append(date_from)
                if date_to:
                    clauses.append("posting_date <= %s::date")
                    params.append(date_to)
                if q:
                    clauses.append("(society ILIKE %s OR locality ILIKE %s OR source ILIKE %s)")
                    like = f"%{q}%"
                    params.extend([like, like, like])
                where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
                cur.execute(f"""
                    SELECT id, source, city, locality, society, bedrooms,
                           area_sqft, floor, price, posting_date, listing_link
                    FROM collated_data
                    {where}
                """, params)
                for r in cur.fetchall():
                    pd = r.get("posting_date")
                    rows.append({
                        "type":     "D Data",
                        "id":       str(r["id"]) if r.get("id") is not None else None,
                        "source":   r.get("source"),
                        "society":  r.get("society"),
                        "city":     r.get("city"),
                        "locality": r.get("locality"),
                        "bhk":      r.get("bedrooms"),
                        "floor":    r.get("floor"),
                        "tower":    None,
                        "unit_no":  None,
                        "area":     r.get("area_sqft"),
                        "price":    float(r["price"]) if r.get("price") is not None else None,
                        "date":     pd.isoformat() if pd else None,
                        "listing_link": r.get("listing_link"),
                    })
        finally:
            put_app_conn(conn)

    # ── 2) properties (Properties DB) → "F Data" ──────────────────
    if type_filter in (None, "F") and properties_configured():
        pconn = get_props_conn()
        try:
            with pconn.cursor() as cur:
                clauses, params = [], []
                if city:
                    clauses.append("LOWER(TRIM(city)) = LOWER(TRIM(%s))")
                    params.append(city)
                if source:
                    clauses.append("LOWER(TRIM(source)) = LOWER(TRIM(%s))")
                    params.append(source)
                if bhk:
                    clauses.append("LOWER(TRIM(configuration)) = LOWER(TRIM(%s))")
                    params.append(bhk)
                if floor:
                    # properties.floor is INT; cast both sides to text for match
                    clauses.append("LOWER(TRIM(COALESCE(floor::text, ''))) = LOWER(TRIM(%s))")
                    params.append(floor)
                if area_min is not None:
                    clauses.append("COALESCE(area_sqft, 0) >= %s")
                    params.append(area_min)
                if area_max is not None:
                    clauses.append("COALESCE(area_sqft, 0) <= %s")
                    params.append(area_max)
                if date_from:
                    clauses.append("schedule_submitted_at >= %s::date")
                    params.append(date_from)
                if date_to:
                    # Inclusive end-of-day so a single-day filter catches the full day
                    clauses.append("schedule_submitted_at < (%s::date + interval '1 day')")
                    params.append(date_to)
                if q:
                    clauses.append("(society_name ILIKE %s OR locality ILIKE %s OR source ILIKE %s)")
                    like = f"%{q}%"
                    params.extend([like, like, like])
                # Hide rows the prod team has marked dead (is_dead=true).
                clauses.append("COALESCE(is_dead, FALSE) = FALSE")
                where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
                cur.execute(f"""
                    SELECT uid, source, city, locality, society_name,
                           configuration, area_sqft, floor, tower_no, unit_no,
                           schedule_submitted_at
                    FROM properties
                    {where}
                """, params)
                for r in cur.fetchall():
                    ts = r.get("schedule_submitted_at")
                    rows.append({
                        "type":     "F Data",
                        "id":       r.get("uid"),
                        "source":   r.get("source"),
                        "society":  r.get("society_name"),
                        "city":     r.get("city"),
                        "locality": r.get("locality"),
                        "bhk":      r.get("configuration"),
                        "floor":    str(r["floor"]) if r.get("floor") is not None else None,
                        "tower":    r.get("tower_no"),
                        "unit_no":  r.get("unit_no"),
                        "area":     float(r["area_sqft"]) if r.get("area_sqft") is not None else None,
                        "price":    None,
                        "date":     ts.isoformat() if ts else None,
                        "listing_link": None,
                    })
        finally:
            put_props_conn(pconn)

    # Server-side sort by chosen column.
    #
    # Special handling:
    #  - DATES are mixed: collated_data.posting_date is a DATE (isoformat
    #    "YYYY-MM-DD"), properties.schedule_submitted_at is a TIMESTAMPTZ
    #    (isoformat "YYYY-MM-DDTHH:MM:SS+00:00"). Compare just the first 10
    #    characters so a same-day bare-date and timestamp sort together
    #    (and so the lexicographic order genuinely reflects calendar order).
    #  - NULLS always sink to the bottom regardless of direction. We do
    #    this by partitioning before sort — using `reverse=True` inverts
    #    the entire list, which would have floated nulls to the top.
    is_str = SORTABLE_COLUMNS[sort_col]["is_str"]

    def _is_empty(v):
        return v is None or (isinstance(v, str) and not v.strip())

    def _key(r):
        v = r.get(sort_col)
        if sort_col == "date":
            return str(v)[:10]   # YYYY-MM-DD only — strips any time/TZ suffix
        if is_str:
            return str(v).lower()
        return v

    non_null = [r for r in rows if not _is_empty(r.get(sort_col))]
    null_rows = [r for r in rows if     _is_empty(r.get(sort_col))]
    non_null.sort(key=_key)
    if direction == "desc":
        non_null.reverse()
    rows = non_null + null_rows

    total = len(rows)
    start = (page - 1) * page_size
    paged = rows[start:start + page_size]

    counts = {
        "D": sum(1 for r in rows if r["type"] == "D Data"),
        "F": sum(1 for r in rows if r["type"] == "F Data"),
    }

    # Facet values for the filter dropdowns. Computed from the FILTERED
    # row set so the dropdowns reflect what's actually visible. Sorted +
    # capped to keep payload reasonable.
    sources = sorted({r["source"] for r in rows if r.get("source")})[:200]
    cities  = sorted({r["city"]   for r in rows if r.get("city")})[:50]
    bhks    = sorted({r["bhk"]    for r in rows if r.get("bhk")})[:50]

    return jsonify({
        "results":   paged,
        "total":     total,
        "page":      page,
        "page_size": page_size,
        "counts":    counts,
        "facets":    {
            "sources": sources,
            "cities":  cities,
            "bhks":    bhks,
        },
        "sort":      sort_col,
        "direction": direction,
    }), 200