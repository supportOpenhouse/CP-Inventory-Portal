"""Submissions CRUD + standalone duplicate check."""

import json

from flask import Blueprint, g, jsonify, request

from auth import require_auth
from db import get_app_conn, put_app_conn
from duplicate_check import check_duplicate
from public_id import generate_public_id, city_to_prefix
from services_email import send_new_submission_alert_async
from utils import to_int, to_str

bp = Blueprint("submissions", __name__, url_prefix="/api")

VALID_STAGES = ["Unapproved", "Submitted", "Evaluation", "Offer Given", "Visit Scheduled", "Closed", "Rejected"]


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
                       sqft, bhk, furnishing, occupancy_status, parking, extra_rooms,
                       exit_facing, balcony_facing, balcony_view,
                       asking_price,
                       status, photos, submitted_at,
                       counter_offer_price, counter_offer_status, counter_offer_at,
                       counter_offer_response_text,
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
    stats["closures"] = stats["Closed"]
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

    # Status logic:
    #   - Perfect match           → Unapproved (admin must review the perfect-match dup)
    #   - Unit-less + collated    → Unapproved (admin reviews potential dup)
    #   - Unit-less + clean       → Submitted (auto-approved, goes straight into pipeline)
    #   - Normal submit           → Submitted (existing default)
    #   - force_create on weak/collated dup (existing "Add anyway" path) → Unapproved
    force_create = bool(data.get("force_create"))
    if is_perfect_match:
        initial_status = "Unapproved"
    elif is_unit_less:
        initial_status = "Unapproved" if has_collated_match else "Submitted"
    else:
        # Normal flow with unit details: weak/collated dups go to Unapproved if force_create,
        # else Submitted. Note we no longer 409 on perfect match (handled above).
        initial_status = "Unapproved" if (dup.get("block") and force_create) else "Submitted"

    # Persist collated_match only when relevant for admin highlighting (Unapproved rows).
    collated_match = has_collated_match and initial_status == "Unapproved"

    import logging
    logging.getLogger(__name__).info(
        "[submission] cp_id=%s society=%r bhk=%r floor=%r skip_unit=%s perfect=%s "
        "collated=%s force_create=%s -> status=%s",
        g.user.get("cp_id"), society_name, data.get("bhk"), data.get("floor"),
        skip_unit_details, is_perfect_match, has_collated_match, force_create, initial_status,
    )

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            # Atomically grab the next public_id for this city.
            # FOR UPDATE inside generate_public_id serializes concurrent inserts.
            public_id = generate_public_id(cur, city_name)

            cur.execute("""
                INSERT INTO submissions (
                    cp_id, society_id, society_name, city_id, public_id,
                    tower, unit_no, floor, sqft, bhk, furnishing,
                    exit_facing, balcony_facing, balcony_view,
                    parking, extra_rooms, occupancy_status,
                    asking_price, seller_name, seller_phone, photos,
                    status, collated_match,
                    unit_less, perfect_match_at_submit
                ) VALUES (
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s,
                    %s, %s, %s,
                    %s, %s::jsonb, %s,
                    %s, %s, %s, %s::jsonb,
                    %s, %s,
                    %s, %s
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
                is_unit_less,
                is_perfect_match,
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

    if is_unit_less and has_collated_match:
        message = "Unit submitted for admin review"
    elif is_unit_less:
        message = "Unit submitted for evaluation"
    elif initial_status == "Unapproved":
        message = "Unit submitted for admin review"
    else:
        message = "Unit submitted for evaluation"

    # Unit-less + collated match: row is still created (so admin sees it in
    # Unapproved with the yellow card), but the frontend renders a Contact RM
    # page similar to perfect-match (Title: "Similar Unit exists with Openhouse").
    # We send the `duplicate` dict and a `show_contact_rm_page=True` flag so
    # the frontend knows to short-circuit into that screen instead of bouncing
    # the CP straight back to the dashboard. We also tag the dict with
    # `unit_less_collated=True` so DuplicateCard can pick the lighter "similar
    # match" rendering vs the harder "already in inventory" perfect-match one.
    show_contact_rm_page = is_unit_less and has_collated_match
    duplicate_payload = None
    if show_contact_rm_page:
        # Per spec, override the body message for the unit-less + collated
        # Contact RM page (the screen header is "Similar Unit exists with
        # Openhouse"; the body explains the 48hr review SLA). The original
        # check_duplicate() message is more abrupt.
        custom_message = (
            f"We already have a similar listing for {society_name} "
            f"({to_str(data.get('bhk')) or 'BHK'}, floor {to_str(data.get('floor')) or '—'}). "
            f"Your unit will be reviewed and an update will be given in the next 48 hours."
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
                SELECT id, cp_id, deleted_at, unit_less, perfect_match_at_submit
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

            conn.commit()
    finally:
        put_app_conn(conn)

    return jsonify({"ok": True, "withdrawn": True}), 200


@bp.post("/submissions/<int:sid>/counter-offer-response")
@require_auth
def counter_offer_response(sid):
    """CP accepts or rejects a pending counter offer from the admin.

    On accept: status -> 'Offer Given', counter_offer_status -> 'accepted'
    On reject: status -> 'Rejected',  counter_offer_status -> 'rejected'
    """
    data = request.get_json(silent=True) or {}
    action = (data.get("action") or "").strip().lower()
    if action not in ("accept", "reject"):
        return jsonify({"error": "action must be 'accept' or 'reject'"}), 400

    # Optional comment from CP (e.g. "counter too low", "price is fine")
    comment = (data.get("comment") or "").strip()
    if len(comment) > 2000:
        comment = comment[:2000]
    comment_or_none = comment or None

    new_status = "Offer Given" if action == "accept" else "Rejected"
    new_co_status = "accepted" if action == "accept" else "rejected"
    event_text = (
        "CP accepted counter offer"
        if action == "accept"
        else "CP rejected counter offer"
    )
    if comment:
        event_text = f'{event_text} — "{comment}"'

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            # Lock the row + verify it belongs to this CP and has a pending offer
            cur.execute(
                """
                SELECT id, cp_id, counter_offer_status, status
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
            conn.commit()
    finally:
        put_app_conn(conn)

    return jsonify({"ok": True, "new_status": new_status}), 200

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