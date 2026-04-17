"""Submissions CRUD + standalone duplicate check."""

import json

from flask import Blueprint, g, jsonify, request

from auth import require_auth
from db import get_app_conn, put_app_conn
from duplicate_check import check_duplicate
from services_email import send_new_submission_alert_async
from utils import to_int, to_str

bp = Blueprint("submissions", __name__, url_prefix="/api")

VALID_STAGES = ["Submitted", "Evaluation", "Offer Given", "Visit Scheduled", "Rejected"]


@bp.get("/submissions")
@require_auth
def list_my_submissions():
    """Return the logged-in CP's submissions + aggregate stats."""
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, society_id, society_name, tower, unit_no, floor,
                       sqft, bhk, furnishing, asking_price, closing_price,
                       status, photos, submitted_at
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
    stats["closures"] = 0  # no "Closed" stage anymore; left at 0 for backwards compat
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
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT city_id FROM societies WHERE id = %s",
                (society_id,),
            )
            soc_row = cur.fetchone()
            if not soc_row:
                return jsonify({"error": "Invalid society_id"}), 400
            society_city_id = soc_row["city_id"]

            if not g.user.get("is_admin", False):
                cur.execute(
                    "SELECT city_id FROM channel_partners WHERE id = %s",
                    (g.user["cp_id"],),
                )
                cp_row = cur.fetchone()
                if (
                    not cp_row
                    or cp_row["city_id"] is None
                    or cp_row["city_id"] != society_city_id
                ):
                    return (
                        jsonify({"error": "This society is not in your service area"}),
                        403,
                    )
    finally:
        put_app_conn(conn)

    # Duplicate check
    dup = check_duplicate(
        society_id=society_id,
        tower=to_str(data.get("tower")),
        unit_no=to_str(data.get("unit_no")),
        floor=to_str(data.get("floor")),
    )
    if dup["block"]:
        return jsonify({"error": "Duplicate", "duplicate": dup}), 409

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO submissions (
                    cp_id, society_id, society_name, city_id,
                    tower, unit_no, floor, sqft, bhk, furnishing,
                    exit_facing, balcony_facing, balcony_view,
                    parking, extra_rooms, registry_status,
                    asking_price, closing_price, seller_name, seller_phone, photos
                ) VALUES (
                    %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s,
                    %s, %s, %s,
                    %s, %s::jsonb, %s,
                    %s, %s, %s, %s, %s::jsonb
                )
                RETURNING id
            """, (
                g.user["cp_id"],
                society_id,
                society_name,
                society_city_id,
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
            ))
            new_id = cur.fetchone()["id"]

            # Seed the initial "Submitted" event
            cur.execute("""
                INSERT INTO submission_events
                    (submission_id, actor_cp_id, kind, to_status, text)
                VALUES (%s, %s, 'system', 'Submitted', 'Unit submitted')
            """, (new_id, g.user["cp_id"]))

            conn.commit()
    finally:
        put_app_conn(conn)

    # Fire email alert to RM of the society's city (non-blocking background send)
    send_new_submission_alert_async(new_id)

    return jsonify({
        "success": True,
        "submission_id": new_id,
        "message": "Unit submitted for evaluation",
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
        tower=to_str(data.get("tower")),
        unit_no=to_str(data.get("unit_no")),
        floor=to_str(data.get("floor")),
    )
    return jsonify(result), 200