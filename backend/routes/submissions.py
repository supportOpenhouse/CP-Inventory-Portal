"""Submissions CRUD + standalone duplicate check."""

import json

from flask import Blueprint, g, jsonify, request

from auth import require_auth
from db import get_app_conn, put_app_conn
from duplicate_check import check_duplicate
from utils import to_int, to_str

bp = Blueprint("submissions", __name__, url_prefix="/api")


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
                       status, submitted_at
                FROM submissions
                WHERE cp_id = %s
                ORDER BY submitted_at DESC
                LIMIT 100
            """, (g.user["cp_id"],))
            subs = cur.fetchall()
    finally:
        put_app_conn(conn)

    stats = {
        "submitted": sum(1 for s in subs if s["status"] == "Submitted"),
        "offers":    sum(1 for s in subs if s["status"] in ("Offer Given", "Accepted")),
        "closures":  sum(1 for s in subs if s["status"] == "Closed"),
    }
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

    # Server-side duplicate check (both tiers block; admin no longer bypasses)
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
                    cp_id, society_id, society_name, tower, unit_no, floor,
                    sqft, bhk, furnishing, exit_facing, balcony_facing, balcony_view,
                    parking, extra_rooms, registry_status,
                    asking_price, closing_price, seller_name, seller_phone
                ) VALUES (
                    %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s,
                    %s, %s::jsonb, %s,
                    %s, %s, %s, %s
                )
                RETURNING id
            """, (
                g.user["cp_id"],
                society_id,
                society_name,
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
            ))
            new_id = cur.fetchone()["id"]
            conn.commit()
    finally:
        put_app_conn(conn)

    return jsonify({
        "success": True,
        "submission_id": new_id,
        "message": "Unit submitted for evaluation",
    }), 201


@bp.post("/check-duplicate")
@require_auth
def check_duplicate_endpoint():
    """Standalone duplicate check (called from the frontend before final submit)."""
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
