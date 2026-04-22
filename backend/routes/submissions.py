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
    """Return the logged-in CP's submissions + aggregate stats."""
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, public_id, society_id, society_name, tower, unit_no, floor,
                       sqft, bhk, furnishing, registry_status, parking, extra_rooms,
                       exit_facing, balcony_facing, balcony_view,
                       asking_price, closing_price,
                       status, photos, submitted_at,
                       counter_offer_price, counter_offer_status, counter_offer_at,
                       counter_offer_response_text
                FROM submissions
                WHERE cp_id = %s
                ORDER BY submitted_at DESC
                LIMIT 100
            """, (g.user["cp_id"],))
            subs = cur.fetchall()
    finally:
        put_app_conn(conn)

    # Aggregate counts across all 5 stages
    stats = {stage: 0 for stage in VALID_STAGES}
    for s in subs:
        if s["status"] in stats:
            stats[s["status"]] += 1

    # Legacy fields for existing frontend (still displayed on dashboard)
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
    # Unapproved queue, but we still run the dup check (without tower/unit) so we can
    # capture a collated_data match for the admin's Unapproved-queue highlight.
    skip_unit_details = bool(data.get("skip_unit_details"))

    if skip_unit_details:
        initial_status = "Unapproved"
        dup = check_duplicate(
            society_id=society_id,
            bhk=to_str(data.get("bhk")),
            tower=None,
            unit_no=None,
            floor=to_str(data.get("floor")),
            cp_id=g.user["cp_id"],
        )
    else:
        # Normal flow — run dup check; allow force_create bypass if CP chose "Add anyway"
        dup = check_duplicate(
            society_id=society_id,
            bhk=to_str(data.get("bhk")),
            tower=to_str(data.get("tower")),
            unit_no=to_str(data.get("unit_no")),
            floor=to_str(data.get("floor")),
            cp_id=g.user["cp_id"],
        )
        force_create = bool(data.get("force_create"))
        if dup["block"] and not force_create:
            return jsonify({"error": "Duplicate", "duplicate": dup}), 409
        initial_status = "Unapproved" if (dup["block"] and force_create) else "Submitted"

    # Flag for admin UI: only persisted for rows landing in Unapproved, since that's
    # where the "partial match from collated_data" highlight is meaningful.
    collated_match = bool(dup.get("collated_match")) and initial_status == "Unapproved"

    import logging
    logging.getLogger(__name__).info(
        "[submission] cp_id=%s society=%r bhk=%r floor=%r skip_unit_details=%s "
        "dup.block=%s dup.collated_match=%s -> initial_status=%s collated_match_to_persist=%s",
        g.user.get("cp_id"), society_name, data.get("bhk"), data.get("floor"),
        skip_unit_details, dup.get("block"), dup.get("collated_match"),
        initial_status, collated_match,
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
                    parking, extra_rooms, registry_status,
                    asking_price, closing_price, seller_name, seller_phone, photos,
                    status, collated_match
                ) VALUES (
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s,
                    %s, %s, %s,
                    %s, %s::jsonb, %s,
                    %s, %s, %s, %s, %s::jsonb,
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
                to_str(data.get("registry_status"), 20),
                to_int(data.get("asking_price")),
                to_int(data.get("closing_price")),
                to_str(data.get("seller_name"), 200),
                to_str(data.get("seller_phone"), 20),
                json.dumps(data.get("photos") or []),
                initial_status,
                collated_match,
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

    # Email alert only for normal submissions; Unapproved ones wait for admin approval
    if initial_status == "Submitted":
        send_new_submission_alert_async(new_id)

    return jsonify({
        "success": True,
        "submission_id": new_id,
        "public_id": public_id,
        "status": initial_status,
        "message": (
            "Unit submitted for admin review"
            if initial_status == "Unapproved"
            else "Unit submitted for evaluation"
        ),
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
