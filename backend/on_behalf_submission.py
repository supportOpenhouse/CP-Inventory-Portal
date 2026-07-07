"""Shared logic for creating a submission on behalf of a target CP."""

import json
import logging

from flask import jsonify

from activity_log import log_activity
from db import get_app_conn, put_app_conn
from duplicate_check import check_duplicate
from listing_rm import resolve_listing_rm
from public_id import generate_public_id, city_to_prefix
from services_email import send_new_submission_alert_async
from utils import to_int, to_str

log = logging.getLogger(__name__)


def execute_on_behalf_submission(
    data: dict,
    *,
    target_cp_id: int,
    target_cp_name: str,
    submitted_by_name: str,
    acting_rm_id: int | None = None,
    activity_action: str = "submission_created_on_behalf",
):
    """Insert a submission on behalf of target_cp_id. Returns (flask_response, status_code)."""
    society_name = to_str(data.get("society") or data.get("society_name"), 200)
    society_text = to_str(data.get("society"), 200) or society_name
    city_name = to_str(data.get("city"), 100)

    if not society_name:
        return jsonify({"error": "society_name is required"}), 400
    if not city_name:
        return jsonify({"error": "city is required"}), 400

    if city_to_prefix(city_name) is None:
        return jsonify({
            "error": f"City {city_name!r} does not have a public_id prefix configured.",
        }), 500

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

    collated_match = has_collated_match
    submissions_match = has_submissions_match and initial_status == "Unapproved"

    log.info(
        "[submission/on-behalf] actor=%r target_cp_id=%s society=%r bhk=%r floor=%r "
        "skip_unit=%s perfect=%s collated=%s submissions=%s force_create=%s -> status=%s",
        submitted_by_name, target_cp_id, society_name, data.get("bhk"), data.get("floor"),
        skip_unit_details, is_perfect_match, has_collated_match, has_submissions_match,
        force_create, initial_status,
    )

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            public_id = generate_public_id(cur, city_name)
            listing_rm_id = acting_rm_id if acting_rm_id else resolve_listing_rm(
                cur, society_name, city_name,
            )

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
                submitted_by_name,
                listing_rm_id,
            ))
            new_id = cur.fetchone()["id"]

            base_text = (
                "Unit flagged as duplicate — pending admin review"
                if initial_status == "Unapproved"
                else "Unit submitted"
            )
            event_text = (
                f"{base_text} (submitted by {submitted_by_name} on behalf of CP {target_cp_name})"
            )
            cur.execute("""
                INSERT INTO submission_events
                    (submission_id, actor_cp_id, kind, to_status, text)
                VALUES (%s, %s, 'system', %s, %s)
            """, (new_id, target_cp_id, initial_status, event_text))

            cur.execute("SELECT public_id FROM submissions WHERE id = %s", (new_id,))
            pid_row = cur.fetchone() or {}
            log_activity(
                cur, action=activity_action, category="submission",
                entity_uid=pid_row.get("public_id"), entity_type="submission", entity_id=new_id,
                details={
                    "target_cp_id": target_cp_id,
                    "target_cp_name": target_cp_name,
                    "initial_status": initial_status,
                    "submitted_by_name": submitted_by_name,
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
        "submitted_by_name": submitted_by_name,
        "target_cp_name": target_cp_name,
        "show_contact_rm_page": show_contact_rm_page,
        "duplicate": duplicate_payload,
    }), 201
