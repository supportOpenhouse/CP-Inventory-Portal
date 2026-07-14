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

from activity_log import log_activity
from auth import require_staff, require_acting_staff, generate_token
from config import Config
from db import (
    get_app_conn, put_app_conn,
    get_props_conn, put_props_conn, properties_configured,
    get_inv_conn, put_inv_conn, inventory_configured,
)
from listing_rm import resolve_listing_rm, upsert_society_mapping
from utils import to_int, to_str

log = logging.getLogger(__name__)

bp = Blueprint("admin", __name__, url_prefix="/api/admin")

VALID_STAGES = ["Unapproved", "Submitted", "Visit Requested", "Offer", "Closure", "Visit Scheduled", "Visit Completed", "Price Rejected", "Rejected"]

# Stages that are set automatically by other flows (visit scheduling, visit
# completion cron, counter-offer endpoint). The /status endpoint refuses
# manual moves INTO these, and the frontend hides the status dropdown when
# the current status is one of these (status changes out of them happen via
# the dedicated endpoints).
AUTO_ONLY_STAGES = {"Visit Scheduled", "Visit Completed", "Offer"}

# Allowed sub-categories when status='Rejected'. Anything else is rejected
# by the API. Order matches the dropdown the admin sees.
REJECTED_REASONS = [
    "Cancelled Post Token",
    "Dead - Legal",
    "Dead - Not Interested",
    "Dead - Sold",
    "Duplicacy",
    "Hold",
    "OH Rejected",
    "Seller Rejected",
    "Visit Cancelled",
]


def require_admin_role(f):
    """Admin only. Use AFTER require_staff."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        if g.user.get("role") != "admin":
            return jsonify({"error": "Admin only"}), 403
        return f(*args, **kwargs)
    return wrapper


def require_admin_or_manager(f):
    """Admin or Manager only. Use AFTER require_staff.

    Used by per-listing RM override endpoints — managers can route work
    within their own team, but plain RMs cannot.

    JWT shapes we accept:
      - role='admin'                              → admin
      - role='manager'   (auth_routes.py default) → manager
      - role='rm', is_manager=True (defensive)    → manager
    """
    @wraps(f)
    def wrapper(*args, **kwargs):
        role = g.user.get("role")
        if role in ("admin", "manager"):
            return f(*args, **kwargs)
        if role == "rm" and bool(g.user.get("is_manager")):
            return f(*args, **kwargs)
        return jsonify({"error": "Admin or Manager only"}), 403
    return wrapper




# ---- helpers ----

# SQL fragment producing the set of rms.id values "in my team" — me plus every
# RM transitively beneath me via rms.manager_id. Walks the full subtree so a
# manager-of-managers sees their indirect reports' data, not just their direct
# reports'. UNION (not UNION ALL) defends against accidental cycles in the
# manager_id graph. One %s placeholder for the root rm_id; wrap the call site
# in `... IN { _TEAM_RM_IDS_SQL }`.
_TEAM_RM_IDS_SQL = (
    "(WITH RECURSIVE my_team(id) AS ("
    " SELECT id FROM rms WHERE id = %s"
    " UNION"
    " SELECT r.id FROM rms r JOIN my_team t ON r.manager_id = t.id"
    ") SELECT id FROM my_team)"
)


def _scoped_city_filter(cur):
    """
    Scope filter applied to submissions list/count/detail queries.

    IMPORTANT: returns SQL that references `s.cp_id` and uses a subquery
    against channel_partners, so it works for queries that don't join
    `channel_partners cp` directly. The `s` alias on submissions is assumed.

    Admin (role='admin'): no restriction.

    RM from rms table (rm_id in JWT):
      - Non-manager : s.cp_id IN (CPs where cp.rm_id = me)
      - Manager     : s.cp_id IN (CPs where cp.rm_id IN my team subtree),
                      where "my team subtree" = me + every RM transitively
                      under me via rms.manager_id. So a manager whose direct
                      reports are themselves managers also sees their reports.
      Unapproved is hidden either way.

    RM from channel_partners (legacy, cp_id in JWT with role='rm'):
      Matches on city text (g.user['city']) OR assigned_rm_id.
    """
    role = g.user.get("role", "cp")
    if role == "admin":
        return "", []

    # Viewer: read-only, city-wide. Sees every active listing in their city
    # regardless of which RM owns it. Denies all if the row has no city text
    # (which would be a misconfigured viewer account).
    if role == "viewer":
        city = g.user.get("city")
        if city:
            return "AND LOWER(TRIM(s.city)) = LOWER(TRIM(%s))", [city]
        return "AND FALSE", []

    rm_id = g.user.get("rm_id")              # new: RM from rms table
    is_manager = bool(g.user.get("is_manager"))
    cp_id_legacy = g.user.get("cp_id")       # legacy RM in channel_partners
    city_legacy = g.user.get("city") if not rm_id else None

    if rm_id:
        # Effective RM = COALESCE(s.listing_rm_id, channel_partners.rm_id).
        # When a per-listing override is set, it WINS over the CP's permanent
        # RM — that's the whole point of the override. So the scope must:
        #   - match if s.listing_rm_id targets me (override hands it to me), OR
        #   - match if no override is set AND the CP's permanent RM is me.
        # Without this, overrides silently fail on the receiving RM's side
        # (the listing stays visible only to the CP's permanent RM).
        if is_manager:
            # "Me + my team" applies to BOTH the override match and the
            # permanent-RM fallback. Team = the full subtree below me in the
            # rms.manager_id hierarchy (recursive — a manager-of-managers
            # sees indirect reports too).
            clause = (
                "("
                f"  s.listing_rm_id IN {_TEAM_RM_IDS_SQL}"
                "  OR ("
                "    s.listing_rm_id IS NULL"
                "    AND s.cp_id IN ("
                "      SELECT id FROM channel_partners"
                f"     WHERE rm_id IN {_TEAM_RM_IDS_SQL}"
                "    )"
                "  )"
                ")"
            )
            params = [rm_id, rm_id]
        else:
            clause = (
                "("
                "  s.listing_rm_id = %s"
                "  OR ("
                "    s.listing_rm_id IS NULL"
                "    AND s.cp_id IN ("
                "      SELECT id FROM channel_partners WHERE rm_id = %s"
                "    )"
                "  )"
                ")"
            )
            params = [rm_id, rm_id]
        # Staff see all stages including Unapproved (full visibility into their CPs' funnel).
        return f"AND {clause}", params

    # Legacy path — RM was a channel_partners row with role='rm'
    if city_legacy or cp_id_legacy:
        clauses = []
        params = []
        if city_legacy:
            clauses.append("LOWER(TRIM(s.city)) = LOWER(TRIM(%s))")
            params.append(city_legacy)
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
        base_sql += " AND LOWER(TRIM(s.city)) = LOWER(TRIM(%s))"
        params.append(city)

    if search:
        base_sql += """ AND (
            s.public_id ILIKE %s OR s.society_name ILIKE %s OR cp.cp_code ILIKE %s
            OR cp.name ILIKE %s OR s.unit_no ILIKE %s
            OR s.seller_name ILIKE %s
        )"""
        like = f"%{search}%"
        params.extend([like, like, like, like, like, like])

    if since_days and since_days > 0:
        base_sql += " AND s.submitted_at > NOW() - (%s || ' days')::interval"
        params.append(str(since_days))

    if cp_id:
        base_sql += " AND s.cp_id = %s"
        params.append(cp_id)

    if rm_id:
        # Filter by EFFECTIVE RM:
        #   - if s.listing_rm_id is set, the override wins, so match on it.
        #   - else fall back to the CP's permanent rm_id.
        # Without this, the admin's "filter by RM" dropdown would miss any
        # listing that's been redirected to a different RM via override.
        base_sql += (
            " AND ("
            "  s.listing_rm_id = %s"
            "  OR (s.listing_rm_id IS NULL AND cp.rm_id = %s)"
            ")"
        )
        params.extend([rm_id, rm_id])

    if bhk:
        # BHK floored to its integer part on both sides: '2.5 BHK' -> '2',
        # so filtering "2 BHK" also returns 2.5-BHK rows (and vice-versa).
        base_sql += " AND SUBSTRING(COALESCE(s.bhk::text, '') FROM '[0-9]+') = SUBSTRING(%s FROM '[0-9]+')"
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


def _sync_status_from_cp_inventory() -> int:
    """Sync submission status from the Properties DB `cp_inventory_status` table.

    `cp_inventory_status` lives alongside `properties` in the Properties DB and
    is auto-populated by the Forms app. Each row carries a `cp_id` (which holds
    a submission's public_id), a `valid_cp_id` flag, and an auto-filled
    `cp_status`.

    Logic:
      1. Find submissions with public_id set, not deleted.
      2. Look up cp_inventory_status rows where valid_cp_id = TRUE and cp_id
         matches one of those public_ids, reading cp_status and supply_status.
      3. status: for a recognised pipeline stage that differs from the current
         status, UPDATE submissions.status and seed a 'status_change' event so
         the timeline, reminder timers and activity log stay consistent.
         Terminal cards (Price Rejected / Rejected) are skipped — a rejection is
         a final human decision the status sync must not override.
      4. status_reason: a raw mirror of supply_status, applied to ALL matched
         cards (including terminal ones). Overwrites the existing reason when
         supply_status is non-empty; never clears it when supply_status is blank.

    Idempotent (only rows whose status/reason differ are touched). Read-only on
    the Properties DB (we only fetch from cp_inventory_status, never write back).
    Best-effort: any error is swallowed and logged so the calling list endpoint
    still returns successfully.

    Returns: count of submissions updated in this call.
    """
    if not properties_configured():
        return 0
    try:
        # 1. Candidate submissions — non-terminal, identifiable, live.
        conn = get_app_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT id, public_id, status, status_reason FROM submissions
                    WHERE public_id IS NOT NULL
                      AND deleted_at IS NULL
                """)
                candidates = cur.fetchall()
        finally:
            put_app_conn(conn)

        if not candidates:
            return 0

        id_by_pubid = {c["public_id"]: c["id"] for c in candidates}
        status_by_pubid = {c["public_id"]: c["status"] for c in candidates}
        reason_by_pubid = {c["public_id"]: c.get("status_reason") for c in candidates}

        # 2. Properties DB — validated cp_inventory_status rows for those ids.
        pconn = get_props_conn()
        try:
            with pconn.cursor() as cur:
                cur.execute("""
                    SELECT cp_id, cp_status, supply_status
                    FROM cp_inventory_status
                    WHERE valid_cp_id = TRUE
                      AND cp_id = ANY(%s)
                """, (list(id_by_pubid.keys()),))
                rows = cur.fetchall()
        finally:
            put_props_conn(pconn)

        if not rows:
            return 0

        # 3. Compute the desired status and/or status_reason for each match.
        #    Two independent flows:
        #      - status: from cp_status, only on non-terminal cards, only for a
        #        recognised pipeline stage that differs (unchanged behaviour).
        #      - status_reason: a raw mirror of supply_status, applied to ALL
        #        matched cards incl. terminal (Rejected) ones. Overwrites when
        #        supply_status is non-empty; never clears on empty.
        TERMINAL = {"Price Rejected", "Rejected"}
        to_update = []  # (submission_id, old_status, new_status|None, new_reason|None)
        for r in rows:
            pubid = r["cp_id"]
            old_status = status_by_pubid.get(pubid)
            if old_status is None:
                continue
            old_reason = reason_by_pubid.get(pubid)

            # --- status (cp_status → submissions.status) ---
            new_status = None
            cp_status = (r["cp_status"] or "").strip()
            if cp_status:
                # Properties DB may still use the legacy stage name — treat it
                # as an alias of the renamed 'Rejected' stage. A cancelled visit
                # is a rejection too, so it also lands in 'Rejected'.
                mapped = "Rejected" if cp_status in ("Duplicate Rejected", "Visit Cancelled") else cp_status
                if old_status in TERMINAL:
                    pass  # never override a final human rejection
                elif mapped not in VALID_STAGES:
                    log.warning(
                        "[sync_cp_status] public_id=%s — ignoring unrecognised "
                        "cp_status=%r", pubid, cp_status,
                    )
                elif mapped != old_status:
                    new_status = mapped

            # --- status_reason (supply_status → submissions.status_reason) ---
            # Raw passthrough; overwrite when source has a value; never clear.
            new_reason = None
            supply = (r["supply_status"] or "").strip()
            if supply and supply != (old_reason or ""):
                new_reason = supply

            # 'Visit Cancelled' is itself a rejection reason: when the source
            # flags it via cp_status, stamp the reason too — unless supply_status
            # already supplied a more specific one above.
            if cp_status == "Visit Cancelled" and new_reason is None and old_reason != "Visit Cancelled":
                new_reason = "Visit Cancelled"

            if new_status is None and new_reason is None:
                continue
            to_update.append((id_by_pubid[pubid], old_status, new_status, new_reason))

        if not to_update:
            return 0

        # 4. Apply each change. Re-assert old_status in the WHERE so a status
        #    changed by someone else between step 1 and now isn't clobbered.
        #    Seed a status_change event only when the stage actually moved.
        conn = get_app_conn()
        try:
            with conn.cursor() as cur:
                updated = 0
                for sub_id, old_status, new_status, new_reason in to_update:
                    sets, params = [], []
                    if new_status is not None:
                        sets.append("status = %s")
                        params.append(new_status)
                    if new_reason is not None:
                        sets.append("status_reason = %s")
                        params.append(new_reason)
                    params += [sub_id, old_status]
                    # sets only ever contains the two fixed assignments above —
                    # no user input in the SQL text, values are parameterised.
                    cur.execute(
                        f"UPDATE submissions SET {', '.join(sets)} "
                        "WHERE id = %s AND status = %s",
                        params,
                    )
                    if cur.rowcount == 0:
                        continue
                    if new_status is not None:
                        cur.execute("""
                            INSERT INTO submission_events
                                (submission_id, actor_cp_id, kind, from_status, to_status, text)
                            VALUES (%s, NULL, 'status_change', %s, %s, %s)
                        """, (
                            sub_id, old_status, new_status,
                            "Status synced from cp_inventory_status.",
                        ))
                    updated += 1
                conn.commit()
        finally:
            put_app_conn(conn)

        if updated:
            log.info("[sync_cp_status] updated %d submissions", updated)
        return updated
    except Exception:
        # Best-effort: never break the admin list because of a sync hiccup.
        log.exception("[sync_cp_status] failed; admin list will continue uninterrupted")
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


# Confident-match tolerance: a priced area within this many sqft of the
# listing's own area counts as a match; beyond it, we surface "area off".
_OH_AREA_TOLERANCE_SQFT = 50


def _oh_norm_society(name):
    """Normalize a society name for matching: keep alphanumerics, lowercase.

    Mirrors the SQL `LOWER(REGEXP_REPLACE(society, '[^a-zA-Z0-9]', '', 'g'))`
    so the Python and DB sides agree (and matches the legacy acquisition-price
    behavior so admins see the same societies match as before)."""
    return re.sub(r"[^a-zA-Z0-9]", "", str(name or "")).lower()


def _attach_oh_pricing(rows):
    """Attach Openhouse pricing fields to each submission dict in place.

    Reads the `oh_pricing` table from the **Inventory DB** (a separate database
    from the app DB, so this can't be a SQL JOIN). Matching is on society +
    area only: among a society's priced rows (acq_price present), pick the one
    whose area_sqft is closest to the listing's sqft.

    Adds to each row:
      oh_price       — matched row's acq_price in rupees, or None
      oh_area        — matched/nearest row's area_sqft, or None
      oh_area_off_by — abs(area diff) in sqft to the nearest priced row, or None
      oh_state       — one of:
          'match'    confident: a priced area within _OH_AREA_TOLERANCE_SQFT
          'area_off' a society price exists but nearest area is further off
          'no_area'  the listing has no sqft, so it can't be area-matched
          'no_match' no priced row exists for this society
          None       pricing data unavailable (Inventory DB unset/unreachable)
                     — the frontend renders nothing in this case.
    """
    if not rows:
        return rows

    for r in rows:
        r["oh_price"] = None
        r["oh_area"] = None
        r["oh_area_off_by"] = None
        r["oh_state"] = None

    if not inventory_configured():
        return rows

    # Distinct normalized societies present in this batch -> the indices of the
    # rows that carry each one (so one query covers the whole page).
    norm_to_idxs = {}
    for i, r in enumerate(rows):
        n = _oh_norm_society(r.get("society_name"))
        if n:
            norm_to_idxs.setdefault(n, []).append(i)
    if not norm_to_idxs:
        return rows

    conn = get_inv_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT LOWER(REGEXP_REPLACE(society, '[^a-zA-Z0-9]', '', 'g')) AS sn,
                       area_sqft, acq_price
                FROM oh_pricing
                WHERE acq_price IS NOT NULL
                  AND area_sqft IS NOT NULL
                  AND LOWER(REGEXP_REPLACE(society, '[^a-zA-Z0-9]', '', 'g')) = ANY(%s)
                """,
                (list(norm_to_idxs.keys()),),
            )
            price_rows = cur.fetchall()
    except Exception:
        # Fail soft: leave oh_state=None so the UI shows nothing rather than a
        # misleading "Check Price" for every card when the lookup breaks.
        log.exception("[oh-pricing] lookup failed; OH price omitted for this batch")
        return rows
    finally:
        put_inv_conn(conn)

    by_society = {}
    for pr in price_rows:
        by_society.setdefault(pr["sn"], []).append(pr)

    for n, idxs in norm_to_idxs.items():
        candidates = by_society.get(n)
        for i in idxs:
            r = rows[i]
            if not candidates:
                r["oh_state"] = "no_match"
                continue
            listing_area = r.get("sqft")
            if not listing_area:
                r["oh_state"] = "no_area"
                continue
            best = min(candidates, key=lambda pr: abs(pr["area_sqft"] - listing_area))
            delta = abs(best["area_sqft"] - listing_area)
            r["oh_area"] = best["area_sqft"]
            r["oh_area_off_by"] = delta
            if delta <= _OH_AREA_TOLERANCE_SQFT:
                r["oh_state"] = "match"
                r["oh_price"] = best["acq_price"]
            else:
                r["oh_state"] = "area_off"

    return rows


def _list_submissions_core(slim: bool = False, limit_per_stage=None, offset: int = 0):
    """Run the filtered admin-board query.

    `slim=True` returns only the columns the Board/Table cards (and bulk
    modals) actually render — the side panel re-fetches the full row via
    `get_submission`. This halves the payload on large boards.
    `slim=False` (default) keeps the full column set for callers that need
    everything (CSV export).

    Pagination:
      `limit_per_stage=None` (default) → return everything matching filters,
        capped at LIMIT 5000 for safety. Used by the CSV export.
      `limit_per_stage=N` → paginated for the admin board:
        - If the request also has a `status` query param, return rows of that
          single status sorted newest-first, paginated with LIMIT N OFFSET k.
        - Otherwise wrap the base query in a window function that keeps the
          top N rows of EACH stage (ROW_NUMBER() OVER PARTITION BY status).
          `offset` is ignored here; the frontend uses the status-form for
          load-more, one stage at a time, after the initial multi-stage page.
    """
    if slim:
        select_clause = """
                    s.id, s.public_id, s.society_name, s.society, s.tower, s.unit_no, s.floor,
                    s.sqft, s.bhk,
                    s.asking_price, s.seller_name,
                    s.counter_offer_price, s.counter_offer_status,
                    s.broker_counter_price,
                    s.status, s.status_reason, s.submitted_at,
                    s.weak_match, s.collated_match, s.submissions_match, s.match_details,
                    s.deleted_at, s.unit_less, s.perfect_match_at_submit, s.withdraw_reason,
                    s.forms_uid, s.scheduled_date, s.scheduled_time, s.field_exec_name,
                    s.submitted_by_name,
                    s.city AS city,
                    cp.id AS cp_id,
                    cp.cp_code, cp.name AS cp_name, cp.onboarded_by AS cp_onboarded_by,
                    rm.name AS assigned_rm_name,
                    listing_rm.name AS listing_rm_name,
                    tmr.submitted_stage_at, tmr.visit_completed_stage_at,
                    tmr.moved_from_status,
                    co.counter_offers_sent, co.cp_counter_offers
        """
    else:
        select_clause = """
                    s.id, s.public_id, s.society_name, s.society, s.tower, s.unit_no, s.floor,
                    s.sqft, s.bhk, s.occupancy_status,
                    s.asking_price,
                    s.seller_name, s.seller_phone,
                    s.status, s.status_reason, s.submitted_at, s.photos, s.weak_match, s.collated_match, s.submissions_match, s.match_details,
                    s.deleted_at, s.drive_links, s.assigned_rm_id, s.listing_rm_id,
                    s.unit_less, s.perfect_match_at_submit, s.withdraw_reason,
                    s.forms_uid, s.scheduled_date, s.scheduled_time, s.field_exec_name,
                    s.submitted_by_name,
                    s.city AS city,
                    cp.id AS cp_id,
                    cp.cp_code, cp.name AS cp_name, cp.phone AS cp_phone,
                    cp.company AS cp_company, cp.onboarded_by AS cp_onboarded_by,
                    rm.name AS assigned_rm_name,
                    listing_rm.name AS listing_rm_name,
                    tmr.submitted_stage_at, tmr.visit_completed_stage_at,
                    tmr.moved_from_status,
                    co.counter_offers_sent, co.cp_counter_offers
        """
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            scope_sql, scope_params = _scoped_city_filter(cur)
            base_sql = f"""
                SELECT
                    {select_clause}
                FROM submissions s
                JOIN channel_partners cp ON s.cp_id = cp.id
                LEFT JOIN channel_partners rm ON s.assigned_rm_id = rm.id
                LEFT JOIN rms listing_rm ON s.listing_rm_id = listing_rm.id
                LEFT JOIN LATERAL (
                    -- Reminder-timer start timestamps, derived from submission_events.
                    -- - submitted_stage_at: last time status entered 'Submitted'
                    --   (drives the cp_visit_reminder timer while status='Submitted').
                    -- - visit_completed_stage_at: last time status entered 'Visit Completed'
                    --   (drives the cp_sellermeeting_reminder timer while status='Visit Completed').
                    -- MAX over to_status keeps the latest transition if a card bounces
                    -- back into the same stage. Legacy rows that pre-date the event log
                    -- get the column as NULL and the frontend falls back to submitted_at.
                    SELECT
                        (SELECT MAX(e.created_at)
                         FROM submission_events e
                         WHERE e.submission_id = s.id
                           AND e.to_status = 'Submitted') AS submitted_stage_at,
                        (SELECT MAX(e.created_at)
                         FROM submission_events e
                         WHERE e.submission_id = s.id
                           AND e.to_status = 'Visit Completed') AS visit_completed_stage_at,
                        -- moved_from_status: the stage a card was demoted FROM on the
                        -- most recent transition INTO 'Unapproved'. NULL when the card
                        -- was created directly as Unapproved (only a 'system' seed
                        -- event, no status_change into Unapproved). The frontend uses
                        -- this to paint cards blue + show a "Moved from X" chip.
                        (SELECT e.from_status
                         FROM submission_events e
                         WHERE e.submission_id = s.id
                           AND e.to_status = 'Unapproved'
                           AND e.from_status IS NOT NULL
                           AND e.from_status <> 'Unapproved'
                         ORDER BY e.created_at DESC
                         LIMIT 1) AS moved_from_status
                ) tmr ON TRUE
                LEFT JOIN LATERAL (
                    -- Counter-offer breakdown: how many counter offers we sent
                    -- vs how many the CP countered back. A CP counter is the
                    -- only counter_offer event whose actor is the submission's
                    -- own CP (actor_cp_id = s.cp_id); ours carry a different
                    -- (admin) cp_id or an rm actor, so actor_cp_id is DISTINCT.
                    SELECT
                        COUNT(*) FILTER (WHERE e.actor_cp_id IS DISTINCT FROM s.cp_id)
                            AS counter_offers_sent,
                        COUNT(*) FILTER (WHERE e.actor_cp_id = s.cp_id)
                            AS cp_counter_offers
                    FROM submission_events e
                    WHERE e.submission_id = s.id AND e.kind = 'counter_offer'
                ) co ON TRUE
                WHERE TRUE {scope_sql}
            """
            params = list(scope_params)
            sql, params = _apply_filters(base_sql, params)

            status_filter = to_str(request.args.get("status"))

            if limit_per_stage is None:
                # Unpaginated path (CSV export). Cap at 5000 for safety.
                sql += " ORDER BY s.submitted_at DESC LIMIT 5000"
            elif status_filter:
                # _apply_filters has already added "AND s.status = %s" — we just
                # paginate the resulting single-stage list.
                sql += " ORDER BY s.submitted_at DESC LIMIT %s OFFSET %s"
                params.extend([limit_per_stage, max(0, int(offset))])
            else:
                # Top N per stage via a window function around the filtered query.
                # All other filters in `sql` already applied; the wrapping just
                # keeps row_number ≤ N within each status bucket.
                sql = f"""
                    SELECT * FROM (
                        SELECT base.*, ROW_NUMBER() OVER (
                            PARTITION BY base.status
                            ORDER BY base.submitted_at DESC
                        ) AS rn
                        FROM ({sql}) base
                    ) ranked
                    WHERE rn <= %s
                    ORDER BY ranked.submitted_at DESC
                """
                params.append(limit_per_stage)

            cur.execute(sql, params)
            rows = cur.fetchall()
    finally:
        put_app_conn(conn)

    # Merge Openhouse prices from the separate Inventory DB (oh_pricing). Done
    # after releasing the app conn so we don't hold it during the cross-DB read.
    return _attach_oh_pricing(rows)


def _stage_counts():
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            scope_sql, scope_params = _scoped_city_filter(cur)
            base_sql = f"""
                SELECT s.status, COUNT(*) AS cnt
                FROM submissions s
                JOIN channel_partners cp ON s.cp_id = cp.id
                WHERE TRUE {scope_sql} AND (s.deleted_at IS NULL OR s.withdraw_reason = 'cp_withdrawn')
            """
            params = list(scope_params)

            city = to_str(request.args.get("city"))
            search = to_str(request.args.get("search"))
            since_days = request.args.get("since_days", type=int)
            cp_id = request.args.get("cp_id", type=int)
            rm_id = request.args.get("rm_id", type=int)
            bhk = to_str(request.args.get("bhk"))
            date_from = to_str(request.args.get("date_from"))
            date_to = to_str(request.args.get("date_to"))

            if city:
                base_sql += " AND LOWER(TRIM(s.city)) = LOWER(TRIM(%s))"
                params.append(city)
            if search:
                base_sql += """ AND (
                    s.public_id ILIKE %s OR s.society_name ILIKE %s OR cp.cp_code ILIKE %s
                    OR cp.name ILIKE %s OR s.unit_no ILIKE %s
                    OR s.seller_name ILIKE %s
                )"""
                like = f"%{search}%"
                params.extend([like, like, like, like, like, like])
            if since_days and since_days > 0:
                base_sql += " AND s.submitted_at > NOW() - (%s || ' days')::interval"
                params.append(str(since_days))
            if cp_id:
                base_sql += " AND s.cp_id = %s"
                params.append(cp_id)
            if rm_id:
                # Same EFFECTIVE-RM rule _apply_filters uses for the list query
                # — match per-listing override first, fall back to the CP's
                # permanent rm. Without this, stage counters keep showing
                # city-wide totals when the RM filter is on, which is the
                # bug a user reported.
                base_sql += (
                    " AND ("
                    "  s.listing_rm_id = %s"
                    "  OR (s.listing_rm_id IS NULL AND cp.rm_id = %s)"
                    ")"
                )
                params.extend([rm_id, rm_id])
            if bhk:
                # BHK floored to its integer part on both sides (see _apply_filters).
                base_sql += " AND SUBSTRING(COALESCE(s.bhk::text, '') FROM '[0-9]+') = SUBSTRING(%s FROM '[0-9]+')"
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
    # `skip_counts=true` is set by load-more / per-stage pagination requests. The
    # board fans those out across every stage at once, and each one used to re-run
    # all three cross-DB properties syncs below — a burst that drains the small
    # props pool ("connection pool exhausted"). The primary board load (which
    # computes counts) already reconciles EVERY matching submission, not just the
    # visible page, so the extra rows a load-more fetches are already synced.
    # Gate the syncs (and, as before, the counts) on that same flag.
    skip_counts = request.args.get("skip_counts", "false").lower() == "true"
    if not skip_counts:
        # Auto-sync Visit Scheduled -> Visit Completed from properties.visit_submitted_at
        # so the admin board reflects field-level updates without a Forms webhook.
        _sync_visit_completed_from_properties()
        # Pull tower/unit_no/floor back from properties for any submission with a
        # forms_uid — properties is authoritative after a visit. Always overwrites.
        _sync_unit_details_from_properties()
        # Sync submission status from the Forms-app cp_inventory_status table
        # (runs last so cp_status has final say). Best-effort; skips terminal cards.
        _sync_status_from_cp_inventory()

    # Pagination: default 15 per stage, capped at 500 for safety. Frontend
    # passes `offset` only when paginating a single stage (status filter is
    # set in the query string). Keeping the default small avoids fanning out
    # 7 large per-stage queries on the initial board load — that was the
    # source of intermittent gateway timeouts on popular cities.
    try:
        limit = int(request.args.get("limit", 15))
    except (TypeError, ValueError):
        limit = 15
    limit = max(1, min(limit, 500))
    try:
        offset = int(request.args.get("offset", 0))
    except (TypeError, ValueError):
        offset = 0
    offset = max(0, offset)

    # Slim payload: only the columns Board/Table cards (and bulk modals)
    # actually render. The side panel re-fetches the full row on click.
    subs = _list_submissions_core(slim=True, limit_per_stage=limit, offset=offset)

    # skip_counts (parsed above) also skips the COUNT-per-stage aggregate on
    # load-more — counts only change when filters change (a fresh reload).
    counts = None if skip_counts else _stage_counts()
    payload = {"submissions": subs}
    if counts is not None:
        payload["counts"] = counts
    return jsonify(payload), 200


@bp.get("/submissions/<int:sid>")
@require_staff
def get_submission(sid: int):
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            scope_sql, scope_params = _scoped_city_filter(cur)
            cur.execute(f"""
                SELECT s.*, s.city AS city,
                       cp.id AS cp_id, cp.cp_code, cp.name AS cp_name,
                       cp.phone AS cp_phone, cp.company AS cp_company,
                       cp.onboarded_by AS cp_onboarded_by,
                       cp.rm_id AS cp_rm_id,
                       cp_rm.name AS cp_rm_name,
                       rm.name AS assigned_rm_name,
                       listing_rm.name AS listing_rm_name,
                       tmr.submitted_stage_at, tmr.visit_completed_stage_at,
                       co.counter_offers_sent, co.cp_counter_offers
                FROM submissions s
                JOIN channel_partners cp ON s.cp_id = cp.id
                LEFT JOIN rms cp_rm ON cp.rm_id = cp_rm.id
                LEFT JOIN channel_partners rm ON s.assigned_rm_id = rm.id
                LEFT JOIN rms listing_rm ON s.listing_rm_id = listing_rm.id
                LEFT JOIN LATERAL (
                    SELECT
                        (SELECT MAX(e.created_at) FROM submission_events e
                         WHERE e.submission_id = s.id AND e.to_status = 'Submitted') AS submitted_stage_at,
                        (SELECT MAX(e.created_at) FROM submission_events e
                         WHERE e.submission_id = s.id AND e.to_status = 'Visit Completed') AS visit_completed_stage_at
                ) tmr ON TRUE
                LEFT JOIN LATERAL (
                    -- Counter-offer breakdown (see _list_submissions_core).
                    SELECT
                        COUNT(*) FILTER (WHERE e.actor_cp_id IS DISTINCT FROM s.cp_id)
                            AS counter_offers_sent,
                        COUNT(*) FILTER (WHERE e.actor_cp_id = s.cp_id)
                            AS cp_counter_offers
                    FROM submission_events e
                    WHERE e.submission_id = s.id AND e.kind = 'counter_offer'
                ) co ON TRUE
                WHERE s.id = %s {scope_sql}
            """, [sid, *scope_params])
            submission = cur.fetchone()
            if not submission:
                return jsonify({"error": "Not found or out of scope"}), 404

            # actor_name / actor_role resolve from either source: channel_partners
            # for CPs and admins (admin role lives in channel_partners with cp_id),
            # and rms for managers and RMs. Whichever id is set on the event row
            # populates the name; the other JOIN returns NULL and COALESCE picks
            # the non-NULL one. Frontend falls back to "System" only when both
            # are NULL (legacy rows or genuine background-job events).
            cur.execute("""
                SELECT e.id, e.kind, e.from_status, e.to_status, e.text, e.created_at,
                       COALESCE(cp.name, r.name) AS actor_name,
                       cp.cp_code AS actor_cp_code,
                       COALESCE(
                           cp.role,
                           CASE
                               WHEN r.is_manager THEN 'manager'
                               WHEN r.id IS NOT NULL THEN 'rm'
                           END
                       ) AS actor_role
                FROM submission_events e
                LEFT JOIN channel_partners cp ON e.actor_cp_id = cp.id
                LEFT JOIN rms r ON e.actor_rm_id = r.id
                WHERE e.submission_id = %s
                ORDER BY e.created_at ASC, e.id ASC
            """, (sid,))
            events = cur.fetchall()
    finally:
        put_app_conn(conn)

    # Openhouse price from the separate Inventory DB (oh_pricing), merged after
    # the app conn is released — same approach as the list query.
    _attach_oh_pricing([submission])

    return jsonify({"submission": submission, "events": events}), 200


@bp.post("/submissions/<int:sid>/status")
@require_staff
@require_acting_staff
def change_status(sid: int):
    """Manual status change.

    Restrictions:
      - new_status must be in VALID_STAGES.
      - Manual moves INTO AUTO_ONLY_STAGES (Visit Scheduled / Visit Completed
        / Offer) are rejected — those stages are set by dedicated
        endpoints (schedule_visit, the visit-completion cron, counter offer).
      - When new_status='Rejected', body MUST include status_reason as one of
        REJECTED_REASONS. status_reason is cleared on any other status.
    """
    data = request.get_json(silent=True) or {}
    new_status = to_str(data.get("status"))
    if not new_status or new_status not in VALID_STAGES:
        return jsonify({"error": f"Invalid status. Must be one of: {VALID_STAGES}"}), 400

    if new_status in AUTO_ONLY_STAGES:
        return jsonify({
            "error": (
                f"'{new_status}' is set automatically, not manually. "
                f"Use Schedule Visit / Counter Offer / the visit-completion flow."
            )
        }), 400

    new_reason = to_str(data.get("status_reason")) or None
    if new_status == "Rejected":
        if new_reason not in REJECTED_REASONS:
            return jsonify({
                "error": f"status_reason is required for 'Rejected'. Must be one of: {REJECTED_REASONS}"
            }), 400
    else:
        new_reason = None

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            scope_sql, scope_params = _scoped_city_filter(cur)
            cur.execute(f"""
                SELECT s.id, s.public_id, s.status, s.status_reason FROM submissions s
                WHERE s.id = %s AND s.deleted_at IS NULL {scope_sql}
                FOR UPDATE OF s
            """, [sid, *scope_params])
            existing = cur.fetchone()
            if not existing:
                return jsonify({"error": "Not found or out of scope"}), 404

            old_status = existing["status"]
            old_reason = existing.get("status_reason")

            if old_status in AUTO_ONLY_STAGES:
                return jsonify({
                    "error": (
                        f"Cannot manually change status from '{old_status}'. "
                        f"Use the dedicated flow (Counter Offer / re-schedule)."
                    )
                }), 400

            if old_status == new_status and old_reason == new_reason:
                return jsonify({"ok": True, "unchanged": True}), 200

            cur.execute(
                "UPDATE submissions SET status = %s, status_reason = %s WHERE id = %s",
                (new_status, new_reason, sid),
            )
            cur.execute("""
                INSERT INTO submission_events
                    (submission_id, actor_cp_id, actor_rm_id, kind, from_status, to_status)
                VALUES (%s, %s, %s, 'status_change', %s, %s)
            """, (sid, g.user.get("cp_id"), g.user.get("rm_id"), old_status, new_status))
            log_activity(
                cur, action="status_change", category="submission",
                entity_uid=existing.get("public_id"), entity_type="submission", entity_id=sid,
                details={
                    "from": old_status, "to": new_status,
                    "from_reason": old_reason, "to_reason": new_reason,
                },
            )
            conn.commit()
    finally:
        put_app_conn(conn)
    return jsonify({
        "ok": True,
        "from": old_status, "to": new_status,
        "from_reason": old_reason, "to_reason": new_reason,
    }), 200


@bp.post("/submissions/<int:sid>/counter-offer")
@require_staff
@require_acting_staff
def send_counter_offer(sid: int):
    """Admin sends a counter offer.

    Payload: { "price_rupees": 9500000 }  (integer, in rupees)
    OR       { "price_lakhs":  95 }        (integer, in lakhs — converted server-side)

    Sending a counter offer from 'Visit Completed' moves the listing to
    'Offer' (displayed as "Offer Given") — an offer is now on the table.
    The CP responds via /api/submissions/<id>/counter-offer-response:
    accept keeps 'Offer', reject moves to 'Price Rejected', counter loops
    counter_offer_status back to 'pending' (the admin can send a fresh
    counter while still in 'Offer').
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
                SELECT id, public_id, status, counter_offer_status
                FROM submissions
                WHERE id = %s
                FOR UPDATE
                """,
                (sid,),
            )
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Submission not found"}), 404
            status = row["status"]
            co_status = row["counter_offer_status"]
            # First counter goes out from 'Visit Completed'. A follow-up
            # counter is allowed while in 'Offer', but only once the
            # broker has countered back (counter_offer_status='broker_countered').
            first_counter = status == "Visit Completed"
            re_counter = status == "Offer" and co_status == "broker_countered"
            if not (first_counter or re_counter):
                return jsonify({
                    "error": "Counter offer only allowed at 'Visit Completed', "
                             "or in 'Offer' after the broker counters back",
                    "current_status": status,
                }), 409

            # Sending the offer advances 'Visit Completed' -> 'Offer'
            # (an offer is now on the table). A re-counter is already in
            # 'Offer', so the status just stays put.
            new_status = "Offer" if first_counter else status
            cur.execute(
                """
                UPDATE submissions
                SET counter_offer_price  = %s,
                    counter_offer_status = 'pending',
                    counter_offer_at     = NOW(),
                    counter_offer_by     = %s,
                    status               = %s
                WHERE id = %s
                """,
                (price_rupees, g.user["cp_id"], new_status, sid),
            )
            cur.execute(
                """
                INSERT INTO submission_events
                    (submission_id, actor_cp_id, actor_rm_id, kind, text)
                VALUES (%s, %s, %s, 'counter_offer', %s)
                """,
                (sid, g.user.get("cp_id"), g.user.get("rm_id"), f"Counter offer sent: ₹{price_rupees:,}"),
            )
            if first_counter:
                cur.execute(
                    """
                    INSERT INTO submission_events
                        (submission_id, actor_cp_id, actor_rm_id,
                         kind, from_status, to_status)
                    VALUES (%s, %s, %s, 'status_change', %s, %s)
                    """,
                    (sid, g.user.get("cp_id"), g.user.get("rm_id"), status, new_status),
                )
            log_activity(
                cur, action="counter_offer_sent", category="submission",
                entity_uid=row.get("public_id"), entity_type="submission", entity_id=sid,
                details={"price_rupees": price_rupees},
            )
            conn.commit()
    finally:
        put_app_conn(conn)

    return jsonify({"ok": True, "counter_offer_price": price_rupees, "new_status": new_status}), 200


@bp.post("/submissions/<int:sid>/comment")
@require_staff
@require_acting_staff
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
                SELECT s.id, s.public_id FROM submissions s
                WHERE s.id = %s
                  AND (s.deleted_at IS NULL OR s.withdraw_reason = 'cp_withdrawn')
                  {scope_sql}
            """, [sid, *scope_params])
            sub = cur.fetchone()
            if not sub:
                return jsonify({"error": "Not found or out of scope"}), 404

            cur.execute("""
                INSERT INTO submission_events (submission_id, actor_cp_id, actor_rm_id, kind, text)
                VALUES (%s, %s, %s, 'comment', %s)
                RETURNING id, created_at
            """, (sid, g.user.get("cp_id"), g.user.get("rm_id"), text.strip()))
            row = cur.fetchone()
            log_activity(
                cur, action="comment_added", category="submission",
                entity_uid=sub.get("public_id"), entity_type="submission", entity_id=sid,
                details={"text": text.strip()[:500]},
            )
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
    "occupancy_status":    ("str", 20),
    "asking_price":        ("int", None),
    "seller_name":         ("str", 200),
    "seller_phone":        ("str", 20),
    "additional_comments": ("text", None),
    "drive_links":         ("text", None),
    "photos":              ("json", None),
    "assigned_rm_id":      ("int", None),   # null = unassigned; city-default applies
}


@bp.patch("/submissions/<int:sid>")
@require_staff
# Unit-details editing is open to every staff role (admin/manager/rm/viewer) —
# only CPs are excluded, and they can't reach admin routes anyway. (Was
# admin-only; deliberately relaxed per product decision.)
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
                "SELECT id, public_id FROM submissions WHERE id = %s AND deleted_at IS NULL",
                (sid,),
            )
            sub = cur.fetchone()
            if not sub:
                return jsonify({"error": "Not found"}), 404

            sql = f"UPDATE submissions SET {', '.join(set_fragments)} WHERE id = %s"
            cur.execute(sql, params + [sid])

            cur.execute("""
                INSERT INTO submission_events (submission_id, actor_cp_id, actor_rm_id, kind, text)
                VALUES (%s, %s, %s, 'comment', %s)
            """, (sid, g.user.get("cp_id"), g.user.get("rm_id"), "Edited: " + "; ".join(changes)))
            log_activity(
                cur, action="submission_edited", category="submission",
                entity_uid=sub.get("public_id"), entity_type="submission", entity_id=sid,
                details={"changes": changes, "fields": list(allowed.keys())},
            )
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
                "SELECT id, public_id, deleted_at FROM submissions WHERE id = %s",
                (sid,),
            )
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Not found"}), 404
            if row["deleted_at"]:
                return jsonify({"ok": True, "already_deleted": True}), 200

            cur.execute("UPDATE submissions SET deleted_at = NOW() WHERE id = %s", (sid,))
            cur.execute("""
                INSERT INTO submission_events (submission_id, actor_cp_id, actor_rm_id, kind, text)
                VALUES (%s, %s, %s, 'system', 'Submission archived by admin')
            """, (sid, g.user.get("cp_id"), g.user.get("rm_id")))
            log_activity(
                cur, action="submission_deleted", category="submission",
                entity_uid=row.get("public_id"), entity_type="submission", entity_id=sid,
            )
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


@bp.get("/properties/by-society")
@require_staff
def list_properties_by_society():
    """Return units already in the properties DB for a given society_name.

    Used by the Schedule Visit flows (single + bulk) to warn the admin that
    Openhouse already has units in this society before pushing a new visit to
    the Forms app. Match is case-insensitive on society_name only (no city
    scoping) per product decision — surfacing extra matches is preferable to
    missing one.

    Query params:
      society_name (required) — name to match against properties.society_name

    Response: { units: [{uid, tower_no, unit_no, area_sqft, configuration, floor}, ...] }
    Hard-capped at 200 rows; dead listings (is_dead=true) excluded.
    """
    society_name = (request.args.get("society_name") or "").strip()
    if not society_name:
        return jsonify({"units": []}), 200
    if not properties_configured():
        return jsonify({"units": []}), 200

    pconn = get_props_conn()
    try:
        with pconn.cursor() as cur:
            cur.execute("""
                SELECT uid, tower_no, unit_no, area_sqft, configuration, floor
                FROM properties
                WHERE LOWER(TRIM(society_name)) = LOWER(TRIM(%s))
                  AND COALESCE(is_dead, FALSE) = FALSE
                ORDER BY tower_no NULLS LAST, unit_no NULLS LAST
                LIMIT 200
            """, (society_name,))
            rows = cur.fetchall()
    finally:
        put_props_conn(pconn)

    units = [{
        "uid":           r.get("uid"),
        "tower_no":      r.get("tower_no"),
        "unit_no":       r.get("unit_no"),
        "area_sqft":     float(r["area_sqft"]) if r.get("area_sqft") is not None else None,
        "configuration": r.get("configuration"),
        "floor":         str(r["floor"]) if r.get("floor") is not None else None,
    } for r in rows]
    return jsonify({"units": units}), 200


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
@require_acting_staff
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
      - Auto-promotes status: if the submission is currently 'Submitted',
        flips it to 'Visit Scheduled' in the same transaction and seeds a
        status_change event so timers/timeline stay coherent. Rows already
        in 'Visit Scheduled' (re-schedule) are untouched.
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
                SELECT s.*, s.city AS city,
                       cp.name AS cp_name, cp.phone AS cp_phone
                FROM submissions s
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

    # Persist on our side + auto-promote status to 'Visit Scheduled' from either
    # 'Submitted' or 'Visit Requested' (the CP-booked stage).
    old_status = sub.get("status")
    promote_status = old_status in ("Submitted", "Visit Requested")
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            if promote_status:
                cur.execute("""
                    UPDATE submissions
                    SET forms_uid       = %s,
                        scheduled_date  = %s,
                        scheduled_time  = %s,
                        field_exec_name = %s,
                        status          = 'Visit Scheduled',
                        status_reason   = NULL
                    WHERE id = %s
                """, (forms_uid, schedule_date, schedule_time, field_exec_name, sid))
                cur.execute("""
                    INSERT INTO submission_events
                        (submission_id, actor_cp_id, actor_rm_id, kind, from_status, to_status, text)
                    VALUES (%s, %s, %s, 'status_change', %s, 'Visit Scheduled',
                            'Auto-promoted to Visit Scheduled on visit scheduling')
                """, (sid, g.user.get("cp_id"), g.user.get("rm_id"), old_status))
            else:
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
                    (submission_id, actor_cp_id, actor_rm_id, kind, text)
                VALUES (%s, %s, %s, 'system', %s)
            """, (
                sid,
                g.user.get("cp_id"),  # NULL for RMs/managers
                g.user.get("rm_id"),  # NULL for admins/CPs
                f"Visit scheduled for {schedule_date} {schedule_time} with {field_exec_name}. "
                f"Forms UID: {forms_uid}{' (already existed)' if already_existed else ''}",
            ))
            log_activity(
                cur, action="visit_scheduled", category="submission",
                entity_uid=sub.get("public_id"), entity_type="submission", entity_id=sid,
                details={
                    "schedule_date": str(schedule_date),
                    "schedule_time": str(schedule_time),
                    "field_exec_name": field_exec_name,
                    "forms_uid": forms_uid,
                    "already_existed": already_existed,
                    "status_promoted": promote_status,
                },
            )
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
        "status_promoted": promote_status,
    }), 200


# ---- Bulk schedule visit ----

# Per-request hard cap. Each item triggers one Forms-app POST (sequential),
# so this also bounds the worst-case admin-facing wait time.
BULK_SCHEDULE_VISIT_MAX_ITEMS = 20


@bp.post("/submissions/bulk-schedule-visit")
@require_staff
@require_acting_staff
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
                SELECT s.*, s.city AS city,
                       cp.name AS cp_name, cp.phone AS cp_phone
                FROM submissions s
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
            "old_status": sub.get("status"),
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
                    promote = s.get("old_status") == "Submitted"
                    if promote:
                        cur.execute("""
                            UPDATE submissions
                            SET forms_uid       = %s,
                                scheduled_date  = %s,
                                scheduled_time  = %s,
                                field_exec_name = %s,
                                status          = 'Visit Scheduled',
                                status_reason   = NULL
                            WHERE id = %s
                        """, (s["uid"], schedule_date, s["schedule_time"], s["field_exec_name"], s["sid"]))
                        cur.execute("""
                            INSERT INTO submission_events
                                (submission_id, actor_cp_id, actor_rm_id, kind, from_status, to_status, text)
                            VALUES (%s, %s, %s, 'status_change', %s, 'Visit Scheduled',
                                    'Auto-promoted to Visit Scheduled on bulk visit scheduling')
                        """, (s["sid"], g.user.get("cp_id"), g.user.get("rm_id"), s.get("old_status")))
                    else:
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
                            (submission_id, actor_cp_id, actor_rm_id, kind, text)
                        VALUES (%s, %s, %s, 'system', %s)
                    """, (
                        s["sid"],
                        g.user.get("cp_id"),  # NULL for RMs/managers
                        g.user.get("rm_id"),  # NULL for admins/CPs
                        f"Visit scheduled (bulk) for {schedule_date} {s['schedule_time']} "
                        f"with {s['field_exec_name']}. Forms UID: {s['uid']}"
                        f"{' (already existed)' if s['already_existed'] else ''}",
                    ))
                # One bulk-level activity row, summarising the batch.
                log_activity(
                    cur, action="visit_scheduled_bulk", category="submission",
                    entity_type="submission_bulk",
                    details={
                        "schedule_date": str(schedule_date),
                        "n_scheduled": len(new_results),
                        "n_already_scheduled": len(already_scheduled),
                        "submission_ids": [s["sid"] for s in new_results][:50],
                    },
                )
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
                       cp.city AS city
                FROM channel_partners cp
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
                       s.city AS city
                FROM submissions s
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
        "Listing ID", "Internal ID", "Submitted at", "Status", "Status Reason", "City", "Society",
        "Tower", "Unit", "Floor", "BHK", "Sqft",
        "Occupancy",
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
            s.get("status_reason") or "",
            s["city"] or "", s["society_name"] or "",
            s["tower"] or "", s["unit_no"] or "", s["floor"] or "",
            s["bhk"] or "", s["sqft"] or "",
            s["occupancy_status"] or "",
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

    Returns: { rms: [ {id, name, phone, email, city, is_manager}, ... ] }
    Active only, ordered by name.
    Defensive: falls back gracefully if city/is_manager columns aren't there yet.
    """
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            try:
                cur.execute("""
                    SELECT r.id, r.name, r.phone, r.email,
                           r.city AS city, r.manager_id,
                           COALESCE(r.is_manager, FALSE) AS is_manager,
                           r.manager_id
                    FROM rms r
                    WHERE COALESCE(r.is_active, TRUE) = TRUE
                    ORDER BY r.name ASC, r.id ASC
                """)
                rows = cur.fetchall()
            except Exception:
                conn.rollback()
                # Fallback for schemas missing city / is_manager / manager_id
                cur.execute("""
                    SELECT r.id, r.name, r.phone, r.email,
                           NULL::varchar AS city,
                           FALSE AS is_manager,
                           NULL::integer AS manager_id
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
@require_admin_or_manager
def set_cp_rm(cp_id: int):
    """Admin or Manager: set channel_partners.rm_id for a CP.

    Request body: { rm_id: <rms.id> | null }
    Response:     { ok: true, rm_id: <value> }

    Plain RMs can VIEW the CP\u2019s current RM (via submission detail) but
    cannot CHANGE it. Managers can change CPs within their own scope
    (their team\u2019s CPs); admins can change any CP. Target RM may be anyone.

    If rm_id is null/omitted, clears the CP\u2019s RM assignment (no-RM state).
    If rm_id is provided, we validate it exists in the `rms` table.
    """
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
            # Verify CP exists AND is in the caller’s scope (no-op for admins,
            # restricts managers to their team’s CPs).
            cp_scope_sql, cp_scope_params = _scoped_cp_filter()
            cur.execute(
                f"SELECT cp.id FROM channel_partners cp WHERE cp.id = %s {cp_scope_sql}",
                [cp_id, *cp_scope_params],
            )
            if cur.fetchone() is None:
                return jsonify({"error": "Channel partner not found or out of scope"}), 404

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
            cur.execute("SELECT cp_code FROM channel_partners WHERE id = %s", (cp_id,))
            cp_row = cur.fetchone() or {}
            log_activity(
                cur, action="cp_rm_changed", category="cp_rm",
                entity_uid=cp_row.get("cp_code"), entity_type="channel_partner", entity_id=cp_id,
                details={"new_rm_id": new_rm_id},
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
@require_acting_staff
def bulk_status():
    """
    Bulk status change.
    Body: { "ids": [1, 2, 3], "status": "Submitted", "status_reason": "Hold" }

    Same restrictions as POST /submissions/<id>/status:
      - new_status must NOT be in AUTO_ONLY_STAGES.
      - When status='Rejected', status_reason must be one of REJECTED_REASONS
        and is applied to every row. Otherwise status_reason is cleared.
      - Rows currently in AUTO_ONLY_STAGES are skipped.
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
    if new_status in AUTO_ONLY_STAGES:
        return jsonify({
            "error": f"'{new_status}' is set automatically, not manually."
        }), 400

    new_reason = to_str(data.get("status_reason")) or None
    if new_status == "Rejected":
        if new_reason not in REJECTED_REASONS:
            return jsonify({
                "error": f"status_reason is required for 'Rejected'. Must be one of: {REJECTED_REASONS}"
            }), 400
    else:
        new_reason = None

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
                SELECT s.id, s.status, s.status_reason FROM submissions s
                WHERE s.id = ANY(%s)
                  AND s.deleted_at IS NULL
                  {scope_sql}
            """, [clean_ids, *scope_params])
            rows = cur.fetchall()
            in_scope = {r["id"]: (r["status"], r.get("status_reason")) for r in rows}

            for sid, (old_status, old_reason) in in_scope.items():
                if old_status in AUTO_ONLY_STAGES:
                    skipped += 1
                    continue
                if old_status == new_status and old_reason == new_reason:
                    skipped += 1
                    continue
                cur.execute(
                    "UPDATE submissions SET status = %s, status_reason = %s WHERE id = %s",
                    (new_status, new_reason, sid),
                )
                cur.execute("""
                    INSERT INTO submission_events
                        (submission_id, actor_cp_id, actor_rm_id, kind, from_status, to_status, text)
                    VALUES (%s, %s, %s, 'status_change', %s, %s, 'Bulk action')
                """, (sid, g.user.get("cp_id"), g.user.get("rm_id"), old_status, new_status))
                updated += 1

            out_of_scope = len(clean_ids) - len(in_scope)
            log_activity(
                cur, action="status_change_bulk", category="submission",
                entity_type="submission_bulk",
                details={
                    "to": new_status,
                    "updated": updated,
                    "skipped_same_status": skipped,
                    "out_of_scope_or_deleted": out_of_scope,
                    "ids": list(in_scope.keys())[:50],
                },
            )
            conn.commit()
    finally:
        put_app_conn(conn)

    return jsonify({
        "ok": True,
        "updated": updated,
        "skipped_same_status": skipped,
        "out_of_scope_or_deleted": out_of_scope,
    }), 200


# @bp.get("/cp/<int:cp_id>/notes")
# @require_staff
# def list_cp_notes(cp_id: int):
#     """List notes for a CP. RM can read notes but only admin creates them."""
#     conn = get_app_conn()
#     try:
#         with conn.cursor() as cur:
#             cur.execute("""
#                 SELECT n.id, n.text, n.created_at,
#                        cp.name AS actor_name, cp.role AS actor_role
#                 FROM cp_notes n
#                 JOIN channel_partners cp ON n.actor_cp_id = cp.id
#                 WHERE n.cp_id = %s
#                 ORDER BY n.created_at DESC
#                 LIMIT 200
#             """, (cp_id,))
#             notes = cur.fetchall()
#     finally:
#         put_app_conn(conn)
#     return jsonify({"notes": notes}), 200


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
            cur.execute("SELECT id, cp_code FROM channel_partners WHERE id = %s", (cp_id,))
            cp_row = cur.fetchone()
            if not cp_row:
                return jsonify({"error": "CP not found"}), 404

            cur.execute("""
                INSERT INTO cp_notes (cp_id, actor_cp_id, text)
                VALUES (%s, %s, %s)
                RETURNING id, created_at
            """, (cp_id, g.user["cp_id"], text.strip()))
            row = cur.fetchone()
            log_activity(
                cur, action="cp_note_added", category="note",
                entity_uid=cp_row.get("cp_code"), entity_type="channel_partner", entity_id=cp_id,
                details={"note_id": row["id"], "text": text.strip()[:500]},
            )
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
            cur.execute("DELETE FROM cp_notes WHERE id = %s RETURNING id, cp_id", (note_id,))
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Not found"}), 404
            log_activity(
                cur, action="cp_note_deleted", category="note",
                entity_type="cp_note", entity_id=note_id,
                details={"cp_id": row.get("cp_id")},
            )
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
      - admin:   no restriction.
      - viewer:  cp.city = my city text (read-only, city-wide).
      - manager: cp.rm_id IN my team subtree.
      - rm:      cp.rm_id = me.
      - else:    deny by default.
    """
    role = g.user.get("role", "cp")
    if role == "admin":
        return "", []

    if role == "viewer":
        city = g.user.get("city")
        if city:
            return "AND LOWER(TRIM(cp.city)) = LOWER(TRIM(%s))", [city]
        return "AND FALSE", []

    rm_id = g.user.get("rm_id")
    is_manager = bool(g.user.get("is_manager"))

    if rm_id:
        if is_manager:
            return f"AND cp.rm_id IN {_TEAM_RM_IDS_SQL}", [rm_id]
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
    """CP search for the on-behalf flow.

    Query string:
      q     — substring of name OR phone (digits-only). REQUIRED, min 2 chars.
      city  — optional city name (e.g. 'Noida'). When given, results are
              restricted to that city AND the caller's personal scope is
              IGNORED (any active non-admin CP in the city is fair game).
              This is the path the new on-behalf flow uses: staff picks a
              city upfront, then sees every CP in it.
      limit — max results (default 20, capped at 50).

    Returns: { results: [{id, cp_code, name, phone, company, city}, ...] }
    Phone matching is digits-only on both sides, so '971' matches '9711382053'.
    Name matching is case-insensitive substring.
    """
    # NB: plain .strip() on the raw query strings — NOT to_str(), which returns
    # None for empty input (so `to_str("").strip()` would crash). This endpoint
    # is called with no `city` by the "View as CP" picker, hitting that path.
    q = (request.args.get("q") or "").strip()
    city = (request.args.get("city") or "").strip()
    limit = max(1, min(50, request.args.get("limit", default=20, type=int) or 20))

    if len(q) < 2:
        return jsonify({"results": []}), 200

    q_digits = re.sub(r"\D", "", q)

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            sql_parts = [
                "SELECT cp.id, cp.cp_code, cp.name, cp.phone, cp.company, cp.city AS city",
                "FROM channel_partners cp",
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

            if city:
                # Explicit city filter: restrict to CPs in that city AND skip
                # the personal scope filter. The "on behalf" use case requires
                # an RM to be able to act on any CP of the chosen city.
                sql_parts.append("AND LOWER(TRIM(cp.city)) = LOWER(TRIM(%s))")
                params.append(city)
            else:
                # No city given — fall back to the caller's personal scope
                # (admins see all; RMs / managers see own / team).
                scope_sql, scope_params = _scoped_cp_filter()
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


@bp.post("/impersonate-cp/<int:cp_id>")
@require_staff
@require_acting_staff
def impersonate_cp(cp_id: int):
    """Mint a short-lived CP-scoped JWT so an admin can open the CP's own app
    in a new tab and act as them ("View as CP"). Admin-only (v1) and audited:
    a cp_impersonation_started row records who started the session, and the
    token carries `impersonated_by` so every CP-side write during the session
    is traceable back to the admin (see activity_log.log_activity).
    """
    if g.user.get("role") != "admin":
        return jsonify({"error": "Only admins can view as a CP"}), 403

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT cp.id, cp.cp_code, cp.name, cp.phone, cp.city,
                       cp.role, cp.is_active, COALESCE(cp.is_admin, FALSE) AS is_admin
                FROM channel_partners cp
                WHERE cp.id = %s
            """, (cp_id,))
            cp = cur.fetchone()
            if not cp:
                return jsonify({"error": "CP not found"}), 404
            if not cp.get("is_active"):
                return jsonify({"error": "CP is inactive"}), 400
            if cp.get("is_admin"):
                return jsonify({"error": "Target is an admin account, not a CP"}), 400

            # Admin display name for the audit log + the CP-side banner.
            cur.execute("SELECT name FROM channel_partners WHERE id = %s", (g.user.get("cp_id"),))
            admin_row = cur.fetchone()
            admin_name = (admin_row or {}).get("name") or g.user.get("cp_code")

            impersonated_by = {
                "cp_id": g.user.get("cp_id"),
                "cp_code": g.user.get("cp_code"),
                "name": admin_name,
            }
            token = generate_token(
                {
                    "id": cp["id"], "cp_code": cp["cp_code"], "phone": cp["phone"],
                    "role": "cp", "city": cp.get("city"), "is_admin": False,
                },
                ttl_minutes=60,
                extra_claims={"impersonated_by": impersonated_by, "impersonation": True},
            )
            log_activity(
                cur, action="cp_impersonation_started", category="security",
                entity_uid=cp["cp_code"], entity_type="channel_partner", entity_id=cp_id,
                details={
                    "impersonated_by_cp_code": g.user.get("cp_code"),
                    "impersonated_by_name": admin_name,
                },
            )
            conn.commit()
    finally:
        put_app_conn(conn)
    return jsonify({"token": token}), 200


@bp.post("/submissions/on-behalf")
@require_staff
@require_acting_staff
def create_submission_on_behalf():
    """Create a submission on behalf of a target CP.

    Mirrors POST /api/submissions (CP-side) but with:
      - target_cp_id required in body; staff must have it in scope.
      - cp_id on the inserted row = target_cp_id (not the staff member).
      - submitted_by_name = staff display name (for audit + UI display).
      - submission_event text annotates "submitted by <staff> on behalf of CP <cp>".

    Same dup-check + status routing as the CP flow:
      - perfect match  -> Rejected (status_reason='Duplicacy', returns 409 + duplicate dict)
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

    society_name = to_str(data.get("society_name"), 200)
    # Admin UI sends society + city text directly; fall back to society_name
    # for the society text when the UI only sends the display name.
    society_text = to_str(data.get("society"), 200) or society_name
    city_name = to_str(data.get("city"), 100)
    if not society_name:
        return jsonify({"error": "society_name is required"}), 400
    if not city_name:
        return jsonify({"error": "city is required"}), 400

    # 1. Load the target CP. We don't apply the personal scope filter here:
    # the new on-behalf flow lets staff pick any CP of a chosen city, not
    # just CPs already assigned to them. Active + non-admin is enough.
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT cp.id, cp.name, cp.phone, cp.cp_code,
                       cp.is_active, COALESCE(cp.is_admin, FALSE) AS is_admin
                FROM channel_partners cp
                WHERE cp.id = %s
            """, (target_cp_id,))
            cp_row = cur.fetchone()
            if not cp_row:
                return jsonify({
                    "error": "Target CP not found.",
                }), 404
            if not cp_row.get("is_active"):
                return jsonify({
                    "error": "Target CP is inactive. Cannot submit on their behalf.",
                }), 400
            if cp_row.get("is_admin"):
                return jsonify({
                    "error": "Target is an admin account, not a CP.",
                }), 400
    finally:
        put_app_conn(conn)

    if city_to_prefix(city_name) is None:
        return jsonify({
            "error": f"City {city_name!r} does not have a public_id prefix configured.",
        }), 500

    # 3. Dup-check (uses target CP's id so RM info is resolved correctly)
    skip_unit_details = bool(data.get("skip_unit_details"))
    dup = check_duplicate(
        society=society_name,
        city=city_name,
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

    # Status logic mirrors the CP-side flow in routes/submissions.py (applies to
    # every acting role — admin / manager / rm):
    #   - Perfect match  → Rejected (status_reason='Duplicacy')
    #   - Unit-less      → Unapproved (always; no tower/unit means admin must verify)
    #   - Collated match → Unapproved (inventory saw the same society+bhk+floor;
    #                      admin reviews even when full tower/unit was given)
    #   - Otherwise      → Submitted, unless force_create is set on a blocked dup
    if is_perfect_match:
        initial_status = "Rejected"
        initial_status_reason = "Duplicacy"
    elif is_unit_less:
        initial_status = "Unapproved"
        initial_status_reason = None
    elif has_collated_match:
        initial_status = "Unapproved"
        initial_status_reason = None
    else:
        initial_status = "Unapproved" if (dup.get("block") and force_create) else "Submitted"
        initial_status_reason = None

    # Persist the collated flag whenever it's true so admin sees the highlight
    # (mirrors submissions.py — NOT gated on status).
    collated_match = has_collated_match
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

            # Routing for on-behalf: the acting RM owns the listing, not
            # the society's default RM. The premise of on-behalf is that the
            # RM is taking the listing from this CP themselves, so they need
            # it on their own board regardless of who the CP's permanent RM
            # is or which RM the society defaults to. Admins don't carry an
            # rm_id — fall back to the society-driven resolver in that case.
            acting_rm_id = g.user.get("rm_id")
            listing_rm_id = acting_rm_id if acting_rm_id else resolve_listing_rm(cur, society_name, city_name)

            cur.execute("""
                INSERT INTO submissions (
                    cp_id, society_name, society, city, public_id,
                    tower, unit_no, floor, sqft, bhk,
                    occupancy_status,
                    asking_price, seller_name, seller_phone, photos,
                    status, status_reason, collated_match, submissions_match,
                    unit_less, perfect_match_at_submit,
                    match_details,
                    submitted_by_name,
                    listing_rm_id
                ) VALUES (
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    %s,
                    %s, %s, %s, %s::jsonb,
                    %s, %s, %s, %s,
                    %s, %s,
                    %s::jsonb,
                    %s,
                    %s
                )
                RETURNING id
            """, (
                target_cp_id,
                society_name,
                society_text,
                city_name,
                public_id,
                to_str(data.get("tower"), 50),
                to_str(data.get("unit_no"), 50),
                to_str(data.get("floor"), 20),
                to_int(data.get("sqft")),
                to_str(data.get("bhk"), 20),
                to_str(data.get("occupancy_status"), 20),
                to_int(data.get("asking_price")),
                to_str(data.get("seller_name"), 200),
                to_str(data.get("seller_phone"), 20),
                json.dumps(data.get("photos") or []),
                initial_status,
                initial_status_reason,
                collated_match,
                submissions_match,
                is_unit_less,
                is_perfect_match,
                json.dumps(dup.get("match_details") or []),
                staff_name,
                listing_rm_id,
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

            # Look up the public_id (assigned by trigger / default) for the log row.
            cur.execute("SELECT public_id FROM submissions WHERE id = %s", (new_id,))
            pid_row = cur.fetchone() or {}
            log_activity(
                cur, action="submission_created_on_behalf", category="submission",
                entity_uid=pid_row.get("public_id"), entity_type="submission", entity_id=new_id,
                details={
                    "target_cp_id": target_cp_id,
                    "target_cp_name": target_cp_name,
                    "initial_status": initial_status,
                    "submitted_by_name": staff_name,
                },
            )

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
@require_admin_or_manager  # admins: any CP. Managers: their team's CPs only.
def bulk_reassign_rm():
    """Reassign a batch of CPs to a different RM.

    Body:
      {
        "cp_ids": [int, int, ...],   # required, non-empty, max 100
        "target_rm_id": int          # required; must exist and be active
      }

    Behavior:
      - Validates target_rm_id exists in `rms` and is_active=TRUE.
      - Loads CPs that match the caller's CP-scope (no-op for admins;
        restricts managers to their own team's CPs). Out-of-scope ids
        come back as "CP not found" in the per-CP results.
      - Inactive CPs are accepted but flagged in the response.
      - Updates rm_id on every in-scope CP atomically (single UPDATE
        with ANY). Target RM may be anyone — managers have the same
        target freedom as admins.
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

            # 2. Load existing CPs to report per-CP outcome — scoped to the
            # caller (no-op for admins). Out-of-scope rows are simply absent
            # from `existing_by_id` and surface as "CP not found".
            cp_scope_sql, cp_scope_params = _scoped_cp_filter()
            cur.execute(f"""
                SELECT cp.id, cp.name, cp.cp_code, cp.phone, cp.rm_id, cp.is_active
                FROM channel_partners cp
                WHERE cp.id = ANY(%s) {cp_scope_sql}
            """, [cp_ids, *cp_scope_params])
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
            log_activity(
                cur, action="cp_rm_changed_bulk", category="cp_rm",
                entity_type="channel_partner_bulk",
                details={
                    "target_rm_id": target_rm_id,
                    "target_rm_name": target_rm_name,
                    "reassigned": len(updated_ids),
                    "skipped": sum(1 for r in results if r.get("skipped")),
                    "not_found": sum(1 for r in results if not r.get("ok")),
                    "cp_ids": updated_ids[:50],
                },
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
@require_admin_or_manager  # admin: any RM. manager: only within their team.
def set_listing_rm(sid: int):
    """Set or clear the per-listing RM override for a single submission.

    Body:
      {
        "target_rm_id":            int | null,   # null clears the override
        "update_society_mapping":  bool          # optional, default false
      }

    Effect:
      submissions.listing_rm_id := target_rm_id (NULL clears).
      When `update_society_mapping` is true AND target_rm_id is not null,
      society_rm_mappings is upserted so future submissions for this
      society also route to target_rm_id. Existing other submissions of
      that society are not touched.

    Manager constraint (admin is unrestricted):
      - the submission must be within the manager's scope (same rule as
        list/detail visibility). Target RM may be anyone — managers have
        the same target freedom as admins.
    """
    data = request.get_json(silent=True) or {}
    raw = data.get("target_rm_id", "__missing__")
    if raw == "__missing__":
        return jsonify({"error": "target_rm_id is required (use null to clear)"}), 400
    target_rm_id = None if raw is None else to_int(raw)
    if raw is not None and not target_rm_id:
        return jsonify({"error": "target_rm_id must be an integer or null"}), 400
    update_society_mapping = bool(data.get("update_society_mapping"))

    conn = get_app_conn()
    society_mapping_updated = False
    try:
        with conn.cursor() as cur:
            rm_name, err = _validate_target_rm(cur, target_rm_id)
            if err:
                body, status = err
                return jsonify(body), status

            scope_sql, scope_params = _scoped_city_filter(cur)
            cur.execute(
                f"SELECT s.id, s.public_id, s.listing_rm_id, s.society_name, s.society "
                f"FROM submissions s "
                f"WHERE s.id = %s AND s.deleted_at IS NULL {scope_sql}",
                [sid, *scope_params],
            )
            sub = cur.fetchone()
            if not sub:
                return jsonify({"error": "Submission not found or out of scope"}), 404

            # Society mapping is independent of the listing-RM diff — even if
            # listing_rm_id is already on target, we still honor a request to
            # write the society mapping (admins may be retroactively setting it).
            if update_society_mapping and target_rm_id and sub.get("society"):
                upsert_society_mapping(cur, sub["society"], target_rm_id)
                society_mapping_updated = True
                log_activity(
                    cur,
                    action="society_rm_mapping_set",
                    category="society",
                    entity_uid=sub.get("society"),
                    entity_type="society",
                    details={
                        "society_name": sub.get("society_name"),
                        "rm_id": target_rm_id,
                        "rm_name": rm_name,
                        "via_submission_id": sid,
                    },
                )

            if sub["listing_rm_id"] == target_rm_id:
                conn.commit()
                return jsonify({
                    "ok": True, "unchanged": True,
                    "listing_rm_id": target_rm_id, "listing_rm_name": rm_name,
                    "society_mapping_updated": society_mapping_updated,
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
            if society_mapping_updated:
                event_text += f"; future {sub.get('society_name') or 'society'} submissions also route to {rm_name}"
            log_activity(
                cur,
                action=("listing_rm_set" if target_rm_id is not None else "listing_rm_cleared"),
                category="submission",
                entity_uid=sub.get("public_id"), entity_type="submission", entity_id=sid,
                details={
                    "target_rm_id": target_rm_id,
                    "target_rm_name": rm_name,
                    "society_mapping_updated": society_mapping_updated,
                },
            )
            cur.execute("""
                INSERT INTO submission_events (submission_id, actor_cp_id, actor_rm_id, kind, text)
                VALUES (%s, %s, %s, 'system', %s)
            """, (sid, g.user.get("cp_id"), g.user.get("rm_id"), event_text))
            conn.commit()
    finally:
        put_app_conn(conn)

    return jsonify({
        "ok": True,
        "submission_id": sid,
        "listing_rm_id": target_rm_id,
        "listing_rm_name": rm_name,
        "society_mapping_updated": society_mapping_updated,
    }), 200


@bp.post("/submissions/bulk-reassign-listing-rm")
@require_staff
@require_admin_or_manager  # admin: any RM. manager: only within their team.
def bulk_reassign_listing_rm():
    """Set or clear the per-listing RM override for many submissions in one call.

    Body:
      {
        "submission_ids":          [int],         # required, non-empty, max 100
        "target_rm_id":            int | null,    # null clears
        "update_society_mapping":  bool           # optional, default false
      }

    Manager constraint (admin is unrestricted):
      - submissions outside the manager's scope are silently skipped
        (counted as not_found in the response). Target RM may be anyone —
        managers have the same target freedom as admins.

    When `update_society_mapping` is true AND target_rm_id is not null,
    every distinct society among the in-scope submissions is upserted into
    society_rm_mappings so future submissions for those societies route to
    target_rm_id. Existing OTHER submissions of those societies are left
    alone; only the ids in the request are reassigned.

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
    update_society_mapping = bool(data.get("update_society_mapping"))

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
    societies_mapped: list[str] = []
    try:
        with conn.cursor() as cur:
            target_rm_name, err = _validate_target_rm(cur, target_rm_id)
            if err:
                body, status = err
                return jsonify(body), status

            # Scope filter — admins get "" (no extra clause); managers get a
            # WHERE chunk that restricts to their team's listings. The clause
            # uses the `s` alias so we have to alias the UPDATE target.
            scope_sql, scope_params = _scoped_city_filter(cur)

            # If we're going to write society mappings, we need the distinct
            # in-scope societies BEFORE the UPDATE narrows to changed-only
            # rows — the mapping should cover every selected (in-scope) row
            # regardless of whether its listing_rm_id was already on target.
            if update_society_mapping and target_rm_id:
                cur.execute(
                    f"SELECT DISTINCT s.society FROM submissions s "
                    f"WHERE s.id = ANY(%s) AND s.deleted_at IS NULL "
                    f"  AND s.society IS NOT NULL AND TRIM(s.society) <> '' "
                    f"  {scope_sql}",
                    [submission_ids, *scope_params],
                )
                # One UPSERT per distinct society text (the mapping's PK/conflict
                # key is now society_rm_mappings.society).
                mapped_rows = cur.fetchall()
                societies_mapped = []
                for r in mapped_rows:
                    if r["society"] in societies_mapped:
                        continue
                    societies_mapped.append(r["society"])
                    upsert_society_mapping(cur, r["society"], target_rm_id)
                if societies_mapped:
                    log_activity(
                        cur,
                        action="society_rm_mapping_set_bulk",
                        category="society",
                        entity_type="society_bulk",
                        details={
                            "rm_id": target_rm_id,
                            "rm_name": target_rm_name,
                            "societies": societies_mapped[:50],
                            "society_count": len(societies_mapped),
                        },
                    )

            cur.execute(f"""
                UPDATE submissions AS s
                SET listing_rm_id = %s
                WHERE s.id = ANY(%s) AND s.deleted_at IS NULL
                  AND COALESCE(s.listing_rm_id, -1) IS DISTINCT FROM COALESCE(%s, -1)
                  {scope_sql}
                RETURNING s.id
            """, [target_rm_id, submission_ids, target_rm_id, *scope_params])
            updated = cur.fetchall()
            updated_ids = [r["id"] for r in updated]

            event_text = (
                f"Listing RM override set to {target_rm_name} (bulk)"
                if target_rm_id is not None
                else "Listing RM override cleared (bulk)"
            )
            if societies_mapped:
                event_text += f"; future submissions for {len(societies_mapped)} societ{'y' if len(societies_mapped) == 1 else 'ies'} also route to {target_rm_name}"
            for sid in updated_ids:
                cur.execute("""
                    INSERT INTO submission_events (submission_id, actor_cp_id, actor_rm_id, kind, text)
                    VALUES (%s, %s, %s, 'system', %s)
                """, (sid, g.user.get("cp_id"), g.user.get("rm_id"), event_text))
            log_activity(
                cur,
                action=("listing_rm_set_bulk" if target_rm_id is not None else "listing_rm_cleared_bulk"),
                category="submission",
                entity_type="submission_bulk",
                details={
                    "target_rm_id": target_rm_id,
                    "target_rm_name": target_rm_name,
                    "updated_count": len(updated_ids),
                    "requested": len(submission_ids),
                    "ids": updated_ids[:50],
                    "society_mappings_updated": len(societies_mapped),
                },
            )
            conn.commit()
    finally:
        put_app_conn(conn)

    log.info(
        "[bulk_reassign_listing_rm] target_rm=%s n_updated=%d (of %d requested) society_mappings=%d",
        target_rm_id, len(updated_ids), len(submission_ids), len(societies_mapped),
    )

    return jsonify({
        "ok": True,
        "target_rm_id": target_rm_id,
        "target_rm_name": target_rm_name,
        "updated_count": len(updated_ids),
        "skipped_already_on_rm": len(submission_ids) - len(updated_ids),
        "submission_ids": updated_ids,
        "society_mappings_updated": len(societies_mapped),
    }), 200


# ============================================================
# Admin Panel: staff-user management
# ============================================================
#
# A small admin-only surface to manage staff users (RMs / managers / admins),
# their per-feature permissions, and force-logout. Backed by:
#   - submissions / channel_partners / rms tables (existing)
#   - `force_logout_at` column added in migrations/2026-05-01-admin-panel.sql
#
# CPs are NOT shown here — they have their own onboarding flow (OTP signup)
# and aren't part of "staff".
# ============================================================


@bp.get("/staff-users")
@require_staff
@require_admin_role
def list_staff_users():
    """All staff users (admins + RMs/managers), merged into one list.

    Each row carries a `source` field so the frontend can route subsequent
    PATCH/DELETE/force-logout calls to the right table:
      source='cp' -> channel_partners (admins, is_admin=TRUE)
      source='rm' -> rms              (RMs and managers)
    """
    rows = []

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, name, phone, email, COALESCE(is_active, TRUE) AS is_active,
                       force_logout_at, created_at
                FROM channel_partners
                WHERE COALESCE(is_admin, FALSE) = TRUE
                ORDER BY id
            """)
            for r in cur.fetchall():
                rows.append({
                    "source":   "cp",
                    "id":       r["id"],
                    "name":     r.get("name") or "",
                    "phone":    r.get("phone") or "",
                    "email":    r.get("email"),
                    "manager_id": None,
                    "role":     "admin",
                    "is_active": bool(r.get("is_active")),
                    "force_logout_at": (
                        r["force_logout_at"].isoformat()
                        if r.get("force_logout_at") else None
                    ),
                    "created_at": r["created_at"].isoformat() if r.get("created_at") else None,
                })
            # Tolerate older schemas where is_viewer column may not exist yet.
            try:
                cur.execute("""
                    SELECT r.id, r.name, r.phone, r.email,
                           COALESCE(r.is_active, TRUE) AS is_active,
                           COALESCE(r.is_manager, FALSE) AS is_manager,
                           COALESCE(r.is_viewer, FALSE)  AS is_viewer,
                           r.city AS city, r.manager_id,
                           r.force_logout_at, r.created_at
                    FROM rms r
                    ORDER BY r.id
                """)
                rm_rows = cur.fetchall()
            except Exception:
                conn.rollback()
                cur.execute("""
                    SELECT r.id, r.name, r.phone, r.email,
                           COALESCE(r.is_active, TRUE) AS is_active,
                           COALESCE(r.is_manager, FALSE) AS is_manager,
                           FALSE AS is_viewer,
                           r.city AS city, r.manager_id,
                           r.force_logout_at, r.created_at
                    FROM rms r
                    ORDER BY r.id
                """)
                rm_rows = cur.fetchall()
            for r in rm_rows:
                if r.get("is_viewer"):
                    role_name = "viewer"
                elif r.get("is_manager"):
                    role_name = "manager"
                else:
                    role_name = "rm"
                rows.append({
                    "source":   "rm",
                    "id":       r["id"],
                    "name":     r.get("name") or "",
                    "phone":    r.get("phone") or "",
                    "email":    r.get("email"),
                    "role":     role_name,
                    "city":     r.get("city"),
                    "manager_id": r.get("manager_id"),
                    "is_active": bool(r.get("is_active")),
                    "force_logout_at": (
                        r["force_logout_at"].isoformat()
                        if r.get("force_logout_at") else None
                    ),
                    "created_at": r["created_at"].isoformat() if r.get("created_at") else None,
                })
    finally:
        put_app_conn(conn)

    rows.sort(key=lambda r: (not r["is_active"], r["role"], r["name"].lower()))
    return jsonify({"users": rows}), 200


@bp.post("/staff-users")
@require_staff
@require_admin_role
def add_staff_user():
    """Add a new staff user.

    Body:
      { "name": str, "phone": str,
        "role": "admin" | "rm" | "manager" | "viewer",
        "email"?: str,
        "city"?: str             # REQUIRED for viewers; ignored for admin
      }

    Phone is normalised to 10 digits; uniqueness is enforced per-table.
    Viewers must have a city (their entire scope is city-bounded).
    """
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    phone_raw = (data.get("phone") or "").strip()
    role = (data.get("role") or "").strip().lower()
    email = (data.get("email") or "").strip() or None
    city = to_str(data.get("city"), 100) or None

    phone = _normalize_phone_to_10_digits(phone_raw)
    errors = []
    if not name:
        errors.append("name is required")
    if not phone or len(phone) != 10 or phone.startswith("0"):
        errors.append("phone must be a valid 10-digit number")
    if role not in ("admin", "rm", "manager", "viewer"):
        errors.append("role must be one of admin / rm / manager / viewer")
    if role == "viewer" and not city:
        errors.append("city is required for viewer accounts")
    if errors:
        return jsonify({"error": "Invalid request", "details": errors}), 400

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            if role == "admin":
                # Channel-partner row with is_admin=TRUE.
                cur.execute("""
                    SELECT id FROM channel_partners
                    WHERE RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 10) = %s
                """, (phone,))
                if cur.fetchone():
                    return jsonify({
                        "error": "A user with that phone already exists in channel_partners.",
                    }), 409
                # Generate a cp_code; admins use their phone-suffix or an ADMIN-XXXX form.
                # Keeping it simple: ADMIN<6digits-of-phone>.
                cp_code = f"ADMIN{phone[-6:]}"
                cur.execute("""
                    INSERT INTO channel_partners
                        (cp_code, name, phone, role, is_admin, is_active)
                    VALUES (%s, %s, %s, 'admin', TRUE, TRUE)
                    RETURNING id
                """, (cp_code, name, phone))
                new_id = cur.fetchone()["id"]
                source = "cp"
            else:
                # RM / Manager / Viewer — all live in `rms`, distinguished by
                # is_manager / is_viewer flags. The CHECK constraint on the
                # table forbids both flags being true at once.
                cur.execute("""
                    SELECT id FROM rms
                    WHERE RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 10) = %s
                """, (phone,))
                if cur.fetchone():
                    return jsonify({
                        "error": "A user with that phone already exists in rms.",
                    }), 409
                # Per repo convention, rms.phone has '+91 ' prefix with space.
                stored_phone = f"+91 {phone}"
                cur.execute("""
                    INSERT INTO rms (name, phone, email, is_manager, is_viewer, city, is_active)
                    VALUES (%s, %s, %s, %s, %s, %s, TRUE)
                    RETURNING id
                """, (
                    name, stored_phone, email,
                    role == "manager",
                    role == "viewer",
                    city if role == "viewer" else None,
                ))
                new_id = cur.fetchone()["id"]
                source = "rm"
            log_activity(
                cur, action="staff_user_added", category="staff_user",
                entity_type=("channel_partner" if source == "cp" else "rm"), entity_id=new_id,
                details={"name": name, "phone": phone, "role": role, "email": email},
            )
            conn.commit()
    finally:
        put_app_conn(conn)

    return jsonify({
        "ok": True,
        "user": {
            "source": source,
            "id": new_id,
            "name": name,
            "phone": phone,
            "email": email,
            "role": role,
            "is_active": True,
        },
    }), 201


def _staff_table(source):
    """Returns the SQL table name for a given source ('cp' or 'rm').
    Raises ValueError otherwise."""
    if source == "cp":
        return "channel_partners"
    if source == "rm":
        return "rms"
    raise ValueError(f"unknown staff source: {source!r}")


@bp.patch("/staff-users/<source>/<int:user_id>")
@require_staff
@require_admin_role
def patch_staff_user(source, user_id):
    """Update a single staff user's permissions / role / activeness.

    Body (all fields optional):
      role                   -> 'admin' | 'rm' | 'manager' | 'viewer'
                                Same-table moves only: within rms you can
                                flip freely between rm / manager / viewer.
                                Admin (channel_partners) ↔ rms moves are
                                rejected — admins can't be demoted in place,
                                they have to be deactivated + re-added.
      city                   -> str | null. Required when flipping to viewer
                                if the row doesn't already have one. Ignored
                                for source='cp'.
      name                   -> str (non-empty)
      phone                  -> str (normalised to 10 digits; must be unique)
      email                  -> str | null
      manager_id             -> int | null (rms only) — the manager this user
                                reports to. Must reference an is_manager row.
      is_active              -> bool
    """
    try:
        table = _staff_table(source)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    data = request.get_json(silent=True) or {}
    sets, params = [], []

    if "name" in data:
        name = to_str(data.get("name"), 200)
        if not name:
            return jsonify({"error": "name cannot be empty"}), 400
        sets.append("name = %s")
        params.append(name)
    if "phone" in data:
        phone = _normalize_phone_to_10_digits((data.get("phone") or "").strip())
        if not phone or len(phone) != 10 or phone.startswith("0"):
            return jsonify({"error": "phone must be a valid 10-digit number"}), 400
        conn_p = get_app_conn()
        try:
            with conn_p.cursor() as cur_p:
                cur_p.execute(
                    f"SELECT id FROM {table} "
                    "WHERE RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 10) = %s AND id <> %s",
                    (phone, user_id),
                )
                if cur_p.fetchone():
                    return jsonify({"error": "Another user already has that phone."}), 409
        finally:
            put_app_conn(conn_p)
        # rms store the '+91 ' prefix (repo convention); channel_partners store raw.
        sets.append("phone = %s")
        params.append(f"+91 {phone}" if source == "rm" else phone)
    if "email" in data:
        sets.append("email = %s")
        params.append(to_str(data.get("email"), 200) or None)
    if source == "rm" and "manager_id" in data:
        mid = data["manager_id"]
        if mid in (None, "", 0, "0"):
            sets.append("manager_id = %s")
            params.append(None)
        else:
            try:
                mid = int(mid)
            except (TypeError, ValueError):
                return jsonify({"error": "manager_id must be an integer or null"}), 400
            if mid == user_id:
                return jsonify({"error": "a user can't be their own manager"}), 400
            conn_m = get_app_conn()
            try:
                with conn_m.cursor() as cur_m:
                    cur_m.execute(
                        "SELECT COALESCE(is_manager, FALSE) AS is_manager FROM rms WHERE id = %s",
                        (mid,),
                    )
                    row_m = cur_m.fetchone()
            finally:
                put_app_conn(conn_m)
            if not row_m:
                return jsonify({"error": "manager not found"}), 400
            if not row_m.get("is_manager"):
                return jsonify({"error": "that user is not a manager"}), 400
            # ponytail: blocks only the direct self-loop; deeper cycles (A→B→A) are
            # tolerated — the team CTE (routes/tickets.py) already UNION-guards
            # traversal, so a cycle can't hang a query.
            sets.append("manager_id = %s")
            params.append(mid)
    if "is_active" in data:
        sets.append("is_active = %s")
        params.append(bool(data["is_active"]))
    if "role" in data:
        new_role = (data["role"] or "").strip().lower()
        if source == "rm" and new_role in ("rm", "manager", "viewer"):
            # All three rms-table roles flip via the is_manager / is_viewer
            # flags. CHECK constraint on the table forbids both being true
            # at once, which we honor by setting them as mutually-exclusive
            # booleans here.
            sets.append("is_manager = %s")
            params.append(new_role == "manager")
            sets.append("is_viewer = %s")
            params.append(new_role == "viewer")
            # Flipping to viewer requires a city. If the row doesn't
            # already have one, require it in the request.
            if new_role == "viewer":
                requested_city = to_str(data.get("city"), 100) or None
                if requested_city:
                    sets.append("city = %s")
                    params.append(requested_city)
                else:
                    conn_chk = get_app_conn()
                    try:
                        with conn_chk.cursor() as cur_chk:
                            cur_chk.execute(
                                "SELECT city FROM rms WHERE id = %s",
                                (user_id,),
                            )
                            row_chk = cur_chk.fetchone()
                    finally:
                        put_app_conn(conn_chk)
                    if not row_chk or not (row_chk.get("city") or "").strip():
                        return jsonify({
                            "error": "city is required when flipping a user to viewer.",
                        }), 400
        elif source == "cp" and new_role == "admin":
            pass  # already admin in channel_partners; nothing to do
        else:
            return jsonify({
                "error": (
                    "Role moves between the channel_partners (admin) and rms "
                    "(rm / manager / viewer) tables aren't supported. "
                    "Deactivate + re-add."
                ),
            }), 400

    if not sets:
        return jsonify({"error": "No supported fields provided"}), 400

    params.append(user_id)
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE {table} SET {', '.join(sets)} WHERE id = %s RETURNING id",
                params,
            )
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "User not found"}), 404
            log_activity(
                cur, action="staff_user_updated", category="staff_user",
                entity_type=("channel_partner" if source == "cp" else "rm"), entity_id=user_id,
                details={k: v for k, v in data.items()
                         if k in ("role", "is_active", "name", "phone", "email", "manager_id")},
            )
            conn.commit()
    finally:
        put_app_conn(conn)
    return jsonify({"ok": True}), 200


@bp.post("/staff-users/<source>/<int:user_id>/force-logout")
@require_staff
@require_admin_role
def force_logout_one(source, user_id):
    """Set force_logout_at = NOW() on a single user. Auth middleware will
    reject any token whose `iat` is older."""
    try:
        table = _staff_table(source)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE {table} SET force_logout_at = NOW() WHERE id = %s RETURNING id",
                (user_id,),
            )
            if not cur.fetchone():
                return jsonify({"error": "User not found"}), 404
            log_activity(
                cur, action="force_logout_user", category="staff_user",
                entity_type=("channel_partner" if source == "cp" else "rm"), entity_id=user_id,
            )
            conn.commit()
    finally:
        put_app_conn(conn)
    return jsonify({"ok": True}), 200


@bp.post("/staff-users/force-logout-all")
@require_staff
@require_admin_role
def force_logout_all():
    """Force-logout every active staff user (RMs/managers + admins). The
    admin who triggered this is INCLUDED — they'll be kicked back to login
    on their next request, same as everyone else. That's intentional: a
    'log everyone out' button should also affect the caller."""
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE channel_partners SET force_logout_at = NOW()
                WHERE COALESCE(is_admin, FALSE) = TRUE
                  AND COALESCE(is_active, TRUE) = TRUE
            """)
            cp_count = cur.rowcount
            cur.execute("""
                UPDATE rms SET force_logout_at = NOW()
                WHERE COALESCE(is_active, TRUE) = TRUE
            """)
            rm_count = cur.rowcount
            log_activity(
                cur, action="force_logout_all", category="staff_user",
                details={"admins": cp_count, "rms": rm_count},
            )
            conn.commit()
    finally:
        put_app_conn(conn)
    log.info("[force_logout_all] admins=%d rms=%d", cp_count, rm_count)
    return jsonify({"ok": True, "logged_out_count": cp_count + rm_count}), 200


# ============================================================
# Activity Log — admin-only feed of mutations across the dashboard
# ============================================================
#
# Mirrors the org-wide activity-log shape (Timestamp / UID / Actor /
# Action / Category / Dashboard / Details). Server-side paginated;
# default page_size = 100, hard cap = 500 to match the user's other
# dashboard's "first 500 results" behaviour.
#
# Actor display name + email are JOINed from channel_partners /
# rms at read time — we don't snapshot them on insert.
# ============================================================


_ACTIVITY_LOG_HARD_CAP = 500


@bp.get("/activity-log")
@require_staff
@require_admin_role
def list_activity_log():
    """Filter + paginate activity_log rows.

    Query params (all optional):
      action       — exact match
      category     — exact match
      actor_email  — exact match (from joined CP / RM table)
      actor_name   — case-insensitive contains (from joined table)
      search       — entity_uid LIKE %q% (matches OHLNC0091, RM0007, etc.)
      date_from    — ISO date, inclusive
      date_to      — ISO date, inclusive (interpreted as end of day)
      page         — 1-based, default 1
      page_size    — default 100, max 500
    """
    action = to_str(request.args.get("action"))
    category = to_str(request.args.get("category"))
    actor_email = to_str(request.args.get("actor_email"))
    actor_name = to_str(request.args.get("actor_name"))
    search = to_str(request.args.get("search"))
    date_from = to_str(request.args.get("date_from"))
    date_to = to_str(request.args.get("date_to"))
    page = max(1, request.args.get("page", default=1, type=int) or 1)
    page_size = request.args.get("page_size", default=100, type=int) or 100
    page_size = max(1, min(page_size, _ACTIVITY_LOG_HARD_CAP))

    where, params = ["1=1"], []
    if action:
        where.append("a.action = %s"); params.append(action)
    if category:
        where.append("a.category = %s"); params.append(category)
    if search:
        where.append("a.entity_uid ILIKE %s"); params.append(f"%{search}%")
    if date_from:
        where.append("a.created_at >= %s::date"); params.append(date_from)
    if date_to:
        where.append("a.created_at < (%s::date + interval '1 day')"); params.append(date_to)
    if actor_email:
        where.append("(cp.email = %s OR rm.email = %s)"); params.extend([actor_email, actor_email])
    if actor_name:
        where.append("(cp.name ILIKE %s OR rm.name ILIKE %s)")
        params.extend([f"%{actor_name}%", f"%{actor_name}%"])

    where_sql = " AND ".join(where)
    offset = (page - 1) * page_size

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            # Total (capped — anything past the cap is a "narrow your filters" prompt).
            cur.execute(f"""
                SELECT COUNT(*) AS n FROM activity_log a
                LEFT JOIN channel_partners cp
                       ON a.actor_type IN ('admin', 'cp') AND cp.id = a.actor_id
                LEFT JOIN rms rm
                       ON a.actor_type IN ('rm', 'manager') AND rm.id = a.actor_id
                WHERE {where_sql}
            """, params)
            total_row = cur.fetchone()
            total = int(total_row["n"]) if total_row else 0

            cur.execute(f"""
                SELECT a.id, a.created_at, a.action, a.category, a.dashboard,
                       a.actor_id, a.actor_type, a.actor_phone,
                       a.entity_uid, a.entity_type, a.entity_id,
                       a.details,
                       COALESCE(cp.name, rm.name)        AS actor_name,
                       COALESCE(cp.email, rm.email)      AS actor_email
                FROM activity_log a
                LEFT JOIN channel_partners cp
                       ON a.actor_type IN ('admin', 'cp') AND cp.id = a.actor_id
                LEFT JOIN rms rm
                       ON a.actor_type IN ('rm', 'manager') AND rm.id = a.actor_id
                WHERE {where_sql}
                ORDER BY a.created_at DESC, a.id DESC
                LIMIT %s OFFSET %s
            """, params + [page_size, offset])
            rows = cur.fetchall()
    finally:
        put_app_conn(conn)

    return jsonify({
        "rows": rows,
        "total": total,
        "page": page,
        "page_size": page_size,
        "has_more": offset + len(rows) < total,
        "cap_reached": total >= _ACTIVITY_LOG_HARD_CAP,
    }), 200


@bp.get("/activity-log/facets")
@require_staff
@require_admin_role
def list_activity_log_facets():
    """Distinct values used to populate the filter dropdowns. Computed
    over the entire table, NOT the current filter set, so dropdowns
    don't narrow as you select things."""
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT DISTINCT action FROM activity_log ORDER BY action")
            actions = [r["action"] for r in cur.fetchall() if r.get("action")]
            cur.execute("SELECT DISTINCT category FROM activity_log ORDER BY category")
            categories = [r["category"] for r in cur.fetchall() if r.get("category")]
            cur.execute("SELECT DISTINCT dashboard FROM activity_log ORDER BY dashboard")
            dashboards = [r["dashboard"] for r in cur.fetchall() if r.get("dashboard")]

            # Actor names + emails — only those that have ever appeared in the log.
            cur.execute("""
                SELECT DISTINCT cp.name AS name, cp.email AS email
                FROM activity_log a JOIN channel_partners cp ON cp.id = a.actor_id
                WHERE a.actor_type IN ('admin','cp') AND cp.name IS NOT NULL
                UNION
                SELECT DISTINCT rm.name AS name, rm.email AS email
                FROM activity_log a JOIN rms rm ON rm.id = a.actor_id
                WHERE a.actor_type IN ('rm','manager') AND rm.name IS NOT NULL
                ORDER BY name
            """)
            actor_rows = cur.fetchall()
    finally:
        put_app_conn(conn)

    return jsonify({
        "actions": actions,
        "categories": categories,
        "dashboards": dashboards,
        "actors": actor_rows,
    }), 200

