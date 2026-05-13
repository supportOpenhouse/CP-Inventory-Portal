"""Submissions CRUD + standalone duplicate check."""

import json

from flask import Blueprint, g, jsonify, request

from activity_log import log_activity
from auth import require_auth
from db import get_app_conn, put_app_conn
from duplicate_check import check_duplicate
from listing_rm import resolve_listing_rm
from public_id import generate_public_id, city_to_prefix
from services_email import send_new_submission_alert_async
from utils import to_int, to_str

bp = Blueprint("submissions", __name__, url_prefix="/api")

VALID_STAGES = ["Unapproved", "Submitted", "Offer Given", "Visit Scheduled", "Visit Completed", "Price Rejected", "Duplicate Rejected"]


@bp.get("/submissions/stats")
@require_auth
def my_submissions_stats():
    """Lightweight stats-only endpoint for the partner home page.

    Returns the same `stats` shape as `GET /api/submissions` but without
    fetching the submission rows themselves. Counts ALL non-withdrawn
    submissions for this broker (the list endpoint caps at 100 most recent).
    """
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT status, COUNT(*) AS n
                FROM submissions
                WHERE cp_id = %s AND deleted_at IS NULL
                GROUP BY status
                """,
                (g.user["cp_id"],),
            )
            rows = cur.fetchall()
    finally:
        put_app_conn(conn)

    stats = {stage: 0 for stage in VALID_STAGES}
    for r in rows:
        if r["status"] in stats:
            stats[r["status"]] = r["n"]
    stats["submitted"] = stats["Submitted"]
    stats["offers"] = stats["Offer Given"]
    return jsonify({"stats": stats}), 200


@bp.get("/submissions")
@require_auth
def list_my_submissions():
    """Return the logged-in CP's submissions + aggregate stats.

    Includes soft-deleted (withdrawn) submissions so the CP can see their
    full history. The frontend distinguishes by checking deleted_at /
    withdraw_reason.
    """
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, public_id, society_id, society_name, tower, unit_no, floor,
                       sqft, bhk, occupancy_status,
                       asking_price,
                       status, photos, submitted_at,
                       counter_offer_price, counter_offer_status, counter_offer_at,
                       counter_offer_response_text,
                       broker_counter_price, broker_counter_at, broker_counter_comment,
                       unit_less, perfect_match_at_submit,
                       deleted_at, withdraw_reason
                FROM submissions
                WHERE cp_id = %s
                ORDER BY submitted_at DESC
                LIMIT 100
            """, (g.user["cp_id"],))
            subs = cur.fetchall()
    finally:
        put_app_conn(conn)

    # Aggregate counts: only count NON-withdrawn submissions in stage stats.
    # Withdrawn rows still appear in the list (greyed out on UI), but they
    # don't pollute the stage counts.
    stats = {stage: 0 for stage in VALID_STAGES}
    for s in subs:
        if s.get("deleted_at"):
            continue
        if s["status"] in stats:
            stats[s["status"]] += 1

    stats["submitted"] = stats["Submitted"]
    stats["offers"] = stats["Offer Given"]
    # Note: 'closures' (Closed) was removed in May 2026 pipeline simplification.
    # If any legacy frontend still expects this key, it'll be undefined.
    return jsonify({"submissions": subs, "stats": stats}), 200


@bp.post("/submissions")
@require_auth
def create_submission():
    """Create a submission. Server-side duplicate check enforced (no bypass)."""
    data = request.get_json(silent=True) or {}

    society_id = data.get("society_id")
    society_name = to_str(data.get("society_name"), 200)

    if not society_id or not society_name:
        return jsonify({"error": "society_id and society_name are required"}), 400

    conn = get_app_conn()
    city_name = None
    society_city_id = None
    try:
        with conn.cursor() as cur:
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
            # Service-area restriction intentionally removed: the Step 1 city dropdown
            # lets CPs pick any of the serviceable cities (Gurgaon, Noida, Ghaziabad),
            # so they can legitimately submit outside their registered city.
    finally:
        put_app_conn(conn)

    # Refuse to insert if city doesn't have a defined public_id prefix.
    # (Prevents us from losing a submission — better to fail loud.)
    if city_to_prefix(city_name) is None:
        return jsonify({
            "error": f"City {city_name!r} does not have a public_id prefix configured. "
                     "Contact support.",
        }), 500

    # ---- Branch: "Submit without unit details" ----
    # CP didn't provide tower/unit and explicitly chose to skip. Goes straight into
    skip_unit_details = bool(data.get("skip_unit_details"))

    # Run dup check in all cases — its result drives status, flags, and CP messaging.
    dup = check_duplicate(
        society_id=society_id,
        bhk=to_str(data.get("bhk")),
        tower=None if skip_unit_details else to_str(data.get("tower")),
        unit_no=None if skip_unit_details else to_str(data.get("unit_no")),
        floor=to_str(data.get("floor")),
        cp_id=g.user["cp_id"],
    )

    # Perfect match = exact dup found in properties or other submissions
    # (only possible when unit details were given). It used to hard-block (409);
    # now it lets the submission through with a flag so CP can review/withdraw.
    is_perfect_match = (
        not skip_unit_details
        and dup.get("match_level") == "exact"
        and bool(dup.get("block"))
    )
    is_unit_less = skip_unit_details
    has_collated_match = bool(dup.get("collated_match"))
    has_submissions_match = bool(dup.get("submissions_match"))

    # Status logic:
    #   - Perfect match → Duplicate Rejected (admin sees red card; CP saw 409 + Contact RM)
    #   - Unit-less     → Unapproved (always — CP didn't give tower/unit, so admin
    #                                 must verify before the listing enters the pipeline,
    #                                 even when no partial match was found)
    #   - Normal submit → Submitted by default; force_create on a weak/collated dup
    #                     (the legacy "Add anyway" path) lands in Unapproved
    force_create = bool(data.get("force_create"))
    if is_perfect_match:
        initial_status = "Duplicate Rejected"
    elif is_unit_less:
        initial_status = "Unapproved"
    else:
        # Normal flow with unit details: weak/collated dups go to Unapproved if force_create,
        # else Submitted. Note we still 409 on perfect match (handled above).
        initial_status = "Unapproved" if (dup.get("block") and force_create) else "Submitted"

    # Persist match flags only when row lands in Unapproved (admin highlight context).
    collated_match = has_collated_match and initial_status == "Unapproved"
    submissions_match = has_submissions_match and initial_status == "Unapproved"

    import logging
    logging.getLogger(__name__).info(
        "[submission] cp_id=%s society=%r bhk=%r floor=%r skip_unit=%s perfect=%s "
        "collated=%s submissions=%s force_create=%s -> status=%s",
        g.user.get("cp_id"), society_name, data.get("bhk"), data.get("floor"),
        skip_unit_details, is_perfect_match, has_collated_match, has_submissions_match,
        force_create, initial_status,
    )

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            # Atomically grab the next public_id for this city.
            # FOR UPDATE inside generate_public_id serializes concurrent inserts.
            public_id = generate_public_id(cur, city_name)

            # Routing: pick the listing's RM from the society mapping (or
            # fall back to a city RM). Stamped at insert so subsequent scope
            # queries don't need to re-resolve.
            listing_rm_id = resolve_listing_rm(cur, society_id)

            cur.execute("""
                INSERT INTO submissions (
                    cp_id, society_id, society_name, city_id, public_id,
                    tower, unit_no, floor, sqft, bhk,
                    occupancy_status,
                    asking_price, seller_name, seller_phone, photos,
                    status, collated_match, submissions_match,
                    unit_less, perfect_match_at_submit,
                    listing_rm_id
                ) VALUES (
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    %s,
                    %s, %s, %s, %s::jsonb,
                    %s, %s, %s,
                    %s, %s,
                    %s
                )
                RETURNING id
            """, (
                g.user["cp_id"],
                society_id,
                society_name,
                society_city_id,
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
                collated_match,
                submissions_match,
                is_unit_less,
                is_perfect_match,
                listing_rm_id,
            ))
            new_id = cur.fetchone()["id"]

            # Seed the initial status event
            event_text = (
                "Unit flagged as duplicate — pending admin review"
                if initial_status == "Unapproved"
                else "Unit submitted"
            )
            cur.execute("""
                INSERT INTO submission_events
                    (submission_id, actor_cp_id, kind, to_status, text)
                VALUES (%s, %s, 'system', %s, %s)
            """, (new_id, g.user["cp_id"], initial_status, event_text))

            cur.execute("SELECT public_id FROM submissions WHERE id = %s", (new_id,))
            pid_row = cur.fetchone() or {}
            log_activity(
                cur, action="submission_created", category="submission",
                entity_uid=pid_row.get("public_id"), entity_type="submission", entity_id=new_id,
                details={"initial_status": initial_status},
            )

            conn.commit()
    finally:
        put_app_conn(conn)

    # Email alert only for normal submissions; Unapproved ones wait for admin approval.
    # Perfect-match rows ARE created and visible to admin in Unapproved (red card),
    # but we don't ping RM with a "new submission" alert since the listing already exists.
    if initial_status == "Submitted":
        send_new_submission_alert_async(new_id)

    # Perfect match: respond 409 so CP sees the "This unit is already with Openhouse"
    # page (with Contact RM only, no Edit/Add anyway). The DB row is still created
    # above so admin sees it as a red card in Unapproved column.
    if is_perfect_match:
        return jsonify({
            "error": "Duplicate",
            "duplicate": dup,
            "submission_id": new_id,
            "public_id": public_id,
        }), 409

    # Message follows status: anything in Unapproved (which now includes every
    # unit-less submission, with or without a partial match) tells the CP that
    # admin review is pending; everything else gets the standard evaluation copy.
    if initial_status == "Unapproved":
        message = "Unit submitted for admin review"
    else:
        message = "Unit submitted for evaluation"

    # Unit-less + (collated OR submissions) match: row is still created (so
    # admin sees it in Unapproved with the appropriate-color card), but the
    # frontend renders a Contact RM page (Title: "Similar Unit exists with
    # Openhouse"). CP-side rendering is yellow regardless of source — the
    # purple/yellow distinction is admin-side only.
    show_contact_rm_page = is_unit_less and (has_collated_match or has_submissions_match)
    duplicate_payload = None
    if show_contact_rm_page:
        # Per spec, override the body message for the unit-less Contact RM page
        # (the screen header is "Similar Unit exists with Openhouse"; the body
        # explains the 48hr review SLA). The original check_duplicate() message
        # is more abrupt.
        custom_message = (
            f"We already have a similar listing for {society_name} "
            f"({to_str(data.get('bhk')) or 'BHK'}, floor {to_str(data.get('floor')) or '—'}). "
            f"Your unit will be reviewed and an update will be given in the next 48 hours."
        )
        duplicate_payload = {
            **dup,
            "message": custom_message,
            "unit_less_collated": True,  # frontend uses this flag for yellow theming
        }

    return jsonify({
        "success": True,
        "submission_id": new_id,
        "public_id": public_id,
        "status": initial_status,
        "unit_less": is_unit_less,
        "message": message,
        "show_contact_rm_page": show_contact_rm_page,
        "duplicate": duplicate_payload,
    }), 201


@bp.post("/check-duplicate")
@require_auth
def check_duplicate_endpoint():
    data = request.get_json(silent=True) or {}
    society_id = data.get("society_id")
    if not society_id:
        return jsonify({"error": "society_id is required"}), 400

    result = check_duplicate(
        society_id=society_id,
        bhk=to_str(data.get("bhk")),
        tower=to_str(data.get("tower")),
        unit_no=to_str(data.get("unit_no")),
        floor=to_str(data.get("floor")),
        cp_id=g.user["cp_id"],
    )
    return jsonify(result), 200


@bp.post("/submissions/<int:sid>/withdraw")
@require_auth
def withdraw_submission(sid):
    """CP soft-deletes their own submission.

    Allowed when:
      - submission is unit-less (CP submitted without a unit number), OR
      - submission was flagged as a perfect match at submit time.

    Sets:
      - deleted_at = NOW()
      - withdraw_reason = 'cp_withdrawn'

    Idempotent: if already withdrawn, returns 200 with no change.

    NOT allowed for normal submissions (with unit details and no perfect-match flag) —
    those need admin to delete via DELETE /admin/submissions/<id>.
    """
    cp_id = g.user.get("cp_id")
    if not cp_id:
        return jsonify({"error": "Only CPs can withdraw"}), 403

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, public_id, cp_id, deleted_at, unit_less, perfect_match_at_submit
                FROM submissions
                WHERE id = %s
            """, (sid,))
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Submission not found"}), 404
            if row["cp_id"] != cp_id:
                return jsonify({"error": "Not your submission"}), 403

            # Already withdrawn? Treat as idempotent success.
            if row["deleted_at"] is not None:
                return jsonify({"ok": True, "already_withdrawn": True}), 200

            # Eligibility: must be unit-less or perfect-match.
            if not (row["unit_less"] or row["perfect_match_at_submit"]):
                return jsonify({
                    "error": "This submission cannot be self-withdrawn. Contact your RM."
                }), 403

            cur.execute("""
                UPDATE submissions
                SET deleted_at = NOW(),
                    withdraw_reason = 'cp_withdrawn'
                WHERE id = %s
            """, (sid,))

            cur.execute("""
                INSERT INTO submission_events
                    (submission_id, actor_cp_id, kind, text)
                VALUES (%s, %s, 'system', 'CP withdrew the submission')
            """, (sid, cp_id))
            log_activity(
                cur, action="submission_withdrawn", category="submission",
                entity_uid=row.get("public_id"), entity_type="submission", entity_id=sid,
            )

            conn.commit()
    finally:
        put_app_conn(conn)

    return jsonify({"ok": True, "withdrawn": True}), 200


@bp.post("/submissions/<int:sid>/counter-offer-response")
@require_auth
def counter_offer_response(sid):
    """CP accepts, rejects, or counters back a pending admin counter offer.

    action='accept'  -> status='Offer Given',     counter_offer_status='accepted'
    action='reject'  -> status='Price Rejected',  counter_offer_status='rejected'
    action='counter' -> status unchanged,         counter_offer_status='broker_countered'
                        + stores broker_counter_price / broker_counter_at / broker_counter_comment
                        (admin can then send a new counter, looping back to 'pending')
    """
    data = request.get_json(silent=True) or {}
    action = (data.get("action") or "").strip().lower()
    if action not in ("accept", "reject", "counter"):
        return jsonify({"error": "action must be 'accept', 'reject', or 'counter'"}), 400

    comment = (data.get("comment") or "").strip()
    if len(comment) > 2000:
        comment = comment[:2000]
    comment_or_none = comment or None

    broker_price = None
    if action == "counter":
        raw_price = data.get("counter_price")
        if raw_price is None:
            raw_price = data.get("price_rupees")
        try:
            broker_price = int(raw_price)
        except (TypeError, ValueError):
            return jsonify({"error": "counter_price (integer rupees) is required for action='counter'"}), 400
        if broker_price <= 0:
            return jsonify({"error": "counter_price must be > 0"}), 400

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, public_id, cp_id, counter_offer_status, status
                FROM submissions
                WHERE id = %s
                FOR UPDATE
                """,
                (sid,),
            )
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Submission not found"}), 404
            if row["cp_id"] != g.user["cp_id"]:
                return jsonify({"error": "Not your submission"}), 403
            if row["counter_offer_status"] != "pending":
                return jsonify({"error": "No pending counter offer"}), 409

            if action == "counter":
                cur.execute(
                    """
                    UPDATE submissions
                    SET counter_offer_status   = 'broker_countered',
                        broker_counter_price   = %s,
                        broker_counter_at      = NOW(),
                        broker_counter_comment = %s
                    WHERE id = %s
                    """,
                    (broker_price, comment_or_none, sid),
                )
                event_text = f"CP countered with ₹{broker_price:,}"
                if comment:
                    event_text = f'{event_text} — "{comment}"'
                cur.execute(
                    """
                    INSERT INTO submission_events
                        (submission_id, actor_cp_id, kind, text)
                    VALUES (%s, %s, 'counter_offer', %s)
                    """,
                    (sid, g.user["cp_id"], event_text),
                )
                log_activity(
                    cur, action="counter_offer_broker_countered", category="submission",
                    entity_uid=row.get("public_id"), entity_type="submission", entity_id=sid,
                    details={"counter_price": broker_price, "comment": comment or None},
                )
                conn.commit()
                return jsonify({
                    "ok": True,
                    "counter_offer_status": "broker_countered",
                    "broker_counter_price": broker_price,
                }), 200

            new_status = "Offer Given" if action == "accept" else "Price Rejected"
            new_co_status = "accepted" if action == "accept" else "rejected"
            event_text = (
                "CP accepted counter offer"
                if action == "accept"
                else "CP rejected counter offer"
            )
            if comment:
                event_text = f'{event_text} — "{comment}"'

            cur.execute(
                """
                UPDATE submissions
                SET status = %s,
                    counter_offer_status = %s,
                    counter_offer_response_text = %s
                WHERE id = %s
                """,
                (new_status, new_co_status, comment_or_none, sid),
            )
            cur.execute(
                """
                INSERT INTO submission_events
                    (submission_id, actor_cp_id, kind, to_status, text)
                VALUES (%s, %s, 'system', %s, %s)
                """,
                (sid, g.user["cp_id"], new_status, event_text),
            )
            log_activity(
                cur,
                action=("counter_offer_accepted" if new_co_status == "accepted" else "counter_offer_rejected"),
                category="submission",
                entity_uid=row.get("public_id"), entity_type="submission", entity_id=sid,
                details={"comment": comment or None},
            )
            conn.commit()
    finally:
        put_app_conn(conn)

    return jsonify({"ok": True, "new_status": new_status}), 200


@bp.patch("/submissions/<int:sid>/asking-price")
@require_auth
def update_asking_price(sid: int):
    """CP updates the asking price on their own submission.

    Allowed in any status except withdrawn (deleted_at IS NOT NULL).
    Body: { "asking_price": 31000000 }  (integer rupees)
    """
    data = request.get_json(silent=True) or {}
    raw_price = data.get("asking_price")
    try:
        new_price = int(raw_price)
    except (TypeError, ValueError):
        return jsonify({"error": "asking_price (integer rupees) is required"}), 400
    if new_price <= 0:
        return jsonify({"error": "asking_price must be > 0"}), 400

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, public_id, cp_id, asking_price, status, deleted_at
                FROM submissions
                WHERE id = %s
                FOR UPDATE
                """,
                (sid,),
            )
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Submission not found"}), 404
            if row["cp_id"] != g.user["cp_id"]:
                return jsonify({"error": "Not your submission"}), 403
            if row.get("deleted_at"):
                return jsonify({"error": "Cannot edit a withdrawn submission"}), 409

            old_price = row.get("asking_price")
            if old_price == new_price:
                return jsonify({"ok": True, "asking_price": new_price, "unchanged": True}), 200

            cur.execute(
                "UPDATE submissions SET asking_price = %s WHERE id = %s",
                (new_price, sid),
            )
            cur.execute(
                """
                INSERT INTO submission_events
                    (submission_id, actor_cp_id, kind, text)
                VALUES (%s, %s, 'system', %s)
                """,
                (sid, g.user["cp_id"],
                 f"CP updated asking price: ₹{(old_price or 0):,} → ₹{new_price:,}"),
            )
            log_activity(
                cur, action="asking_price_updated", category="submission",
                entity_uid=row.get("public_id"), entity_type="submission", entity_id=sid,
                details={"old": old_price, "new": new_price},
            )
            conn.commit()
    finally:
        put_app_conn(conn)

    return jsonify({"ok": True, "asking_price": new_price}), 200

@bp.get("/submissions/<int:sid>/events")
@require_auth
def list_my_submission_events(sid: int):
    """Return the event timeline for one of the CP's own submissions.

    Used by the CP dashboard's expand-modal "Timeline" section.
    """
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            # Verify this submission belongs to this CP
            cur.execute(
                "SELECT cp_id FROM submissions WHERE id = %s",
                (sid,),
            )
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Submission not found"}), 404
            if row["cp_id"] != g.user["cp_id"]:
                return jsonify({"error": "Not your submission"}), 403

            cur.execute(
                """
                SELECT id, kind, from_status, to_status, text, created_at
                FROM submission_events
                WHERE submission_id = %s
                ORDER BY created_at ASC
                """,
                (sid,),
            )
            events = cur.fetchall()
    finally:
        put_app_conn(conn)

    return jsonify({"events": events}), 200