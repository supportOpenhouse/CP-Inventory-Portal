"""Scheduled-job endpoints, called by an external cron (GitHub Actions /
Render cron / cron-job.org) rather than the in-process scheduler that
this app doesn't have. Auth is a shared secret in the X-Sync-Token
header (same convention as /api/sync/*) so anyone with the token can
trigger the job — treat it like a write credential.

Endpoints:
    POST /api/cron/send-cp-reminders
        Dispatches the CP visit/seller-meeting WhatsApp reminders for
        days 1, 2, 4 and 7 of each active timer.

Idempotency: every send is recorded in `cp_reminders_sent` with a
unique constraint on (submission_id, kind, day_number). Re-running the
cron on the same day is a no-op.
"""

import json
import logging

from flask import Blueprint, jsonify, request

from activity_log import log_activity
from config import Config
from db import get_app_conn, put_app_conn
from services_whatsapp import send_template


def _normalize_phone(raw):
    """Strip non-digits, return the last 10 digits or None."""
    if raw is None:
        return None
    digits = "".join(c for c in str(raw) if c.isdigit())
    return digits[-10:] if len(digits) >= 10 else None

log = logging.getLogger(__name__)

bp = Blueprint("cron", __name__, url_prefix="/api/cron")


# Day numbers (forward from the timer start, NOT days-left from the
# 7-day deadline) at which we fire a WhatsApp reminder.
_REMINDER_DAYS = (1, 2, 4, 7)


def _require_cron_auth():
    expected = (Config.CP_REMINDER_CRON_TOKEN or "").strip()
    if not expected:
        log.error("[cron] CP_REMINDER_CRON_TOKEN not configured")
        return jsonify({"error": "Cron endpoint not configured"}), 503
    got = request.headers.get("X-Sync-Token", "")
    if not got or got != expected:
        log.warning("[cron] auth failed (header missing or mismatch)")
        return jsonify({"error": "Unauthorized"}), 401
    return None


def _format_unit_label(tower, unit_no, society_name):
    """Build the "{Tower, Unit - Society}" string used as {{2}} in the
    Interakt templates. Falls back gracefully when tower/unit are blank
    (common for unit-less submissions promoted to Submitted).
    """
    parts = []
    if tower and unit_no:
        parts.append(f"{tower}-{unit_no}")
    elif tower:
        parts.append(str(tower))
    elif unit_no:
        parts.append(str(unit_no))
    label = " - ".join(parts) if parts else ""
    if society_name:
        return f"{label} - {society_name}" if label else str(society_name)
    return label or "your unit"


@bp.post("/send-cp-reminders")
def send_cp_reminders():
    """Find every active timer (Submitted → schedule-visit deadline, or
    Visit Completed → seller-meeting deadline), figure out which
    reminder days are due, send the templates, and record each send.

    The frontend countdown bar shows the SAME data this job acts on, so
    "you can see X day left on the card" and "we sent the day-X WhatsApp"
    are guaranteed to agree.
    """
    auth_err = _require_cron_auth()
    if auth_err is not None:
        return auth_err

    # ?dry_run=true returns the planned sends without calling Interakt.
    # Used to verify the job before turning live sends on in production.
    dry_run = request.args.get("dry_run", "false").lower() == "true"

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            # Pull every row where a timer is currently running. A timer is
            # "running" when:
            #   - status is Submitted (visit timer), OR status is Visit Completed
            #     (seller-meet timer)
            #   - the corresponding stage_at event exists (legacy rows with no
            #     submission_events fall through; we backstop with submitted_at
            #     so they still get reminders)
            #   - deleted_at IS NULL
            # We compute hours-since-start (not calendar-days) so a Day-N
            # reminder fires exactly N*24 hours after stage entry, not at the
            # next IST midnight. With a 2-hour cron cadence this gives every
            # CP their reminder within 2h of the actual N-day boundary,
            # regardless of when in the day they entered the stage.
            cur.execute(
                """
                SELECT
                    s.id              AS submission_id,
                    s.public_id,
                    s.status,
                    s.tower,
                    s.unit_no,
                    s.society_name,
                    cp.name           AS cp_name,
                    cp.phone          AS cp_phone,
                    GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (
                        NOW() - COALESCE(
                            (SELECT MAX(e.created_at) FROM submission_events e
                              WHERE e.submission_id = s.id AND e.to_status = s.status),
                            s.submitted_at
                        )
                    )) / 3600)::int) AS hours_since_start
                FROM submissions s
                JOIN channel_partners cp ON s.cp_id = cp.id
                WHERE s.deleted_at IS NULL
                  AND s.status IN ('Submitted', 'Visit Completed')
                """
            )
            rows = cur.fetchall()

            # Pull every (submission, kind, day) that's already been recorded
            # as sent (or backfill-seeded). Dry-run uses this to predict the
            # real run's output; the live path still uses INSERT ... ON
            # CONFLICT as the source of truth for dedup.
            cur.execute("SELECT submission_id, kind, day_number FROM cp_reminders_sent")
            already_sent = {
                (r["submission_id"], r["kind"], r["day_number"])
                for r in cur.fetchall()
            }
    finally:
        put_app_conn(conn)

    sent = 0
    failed = 0
    skipped_already_sent = 0
    skipped_other = 0
    planned = []  # populated only when dry_run=true

    for row in rows:
        hours = int(row["hours_since_start"])
        days = hours // 24  # for the template body's "days_left" param
        # We send EVERY due day that hasn't yet been sent. Catches the case
        # where the job missed a slot (cron downtime) — the next run still
        # fires the back-dated reminder. Eligibility is in HOURS, not
        # calendar-days, so a card moved into Submitted at 3pm Mon gets
        # its Day-1 reminder shortly after 3pm Tue, not at midnight Mon→Tue.
        due_days = [d for d in _REMINDER_DAYS if hours >= d * 24]
        if not due_days:
            continue

        kind = "visit" if row["status"] == "Submitted" else "seller_meet"
        template_name = (
            "cp_visit_reminder" if kind == "visit" else "cp_sellermeeting_reminder"
        )
        unit_label = _format_unit_label(
            row.get("tower"), row.get("unit_no"), row.get("society_name"),
        )
        cp_first_name = (row.get("cp_name") or "there").split()[0] if row.get("cp_name") else "there"

        for day in due_days:
            # Honour cp_reminders_sent in BOTH dry-run and live paths so the
            # dry-run accurately previews what the real run would do
            # (especially after a pre-rollout backfill seed). Live path's
            # source of truth is still the INSERT ... ON CONFLICT below.
            if (row["submission_id"], kind, day) in already_sent:
                skipped_already_sent += 1
                continue

            days_left = max(0, 7 - days)

            if dry_run:
                planned.append({
                    "submission_id": row["submission_id"],
                    "public_id": row.get("public_id"),
                    "kind": kind,
                    "day": day,
                    "days_since_start": days,
                    "hours_since_start": hours,
                    "days_left": days_left,
                    "phone": row.get("cp_phone"),
                    "template": template_name,
                    "params": [cp_first_name, unit_label, str(days_left)],
                })
                continue

            # Reserve the (submission, kind, day) slot BEFORE sending so two
            # concurrent cron runs can't double-fire. ON CONFLICT means the
            # row is already there → another worker won.
            conn = get_app_conn()
            inserted_id = None
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO cp_reminders_sent (submission_id, kind, day_number)
                        VALUES (%s, %s, %s)
                        ON CONFLICT (submission_id, kind, day_number) DO NOTHING
                        RETURNING id
                        """,
                        (row["submission_id"], kind, day),
                    )
                    res = cur.fetchone()
                    if res:
                        inserted_id = res["id"]
                    conn.commit()
            finally:
                put_app_conn(conn)

            if inserted_id is None:
                skipped_already_sent += 1
                continue

            result = send_template(
                phone=row.get("cp_phone") or "",
                template_name=template_name,
                params=[cp_first_name, unit_label, str(days_left)],
            )

            # Persist the provider response on the reservation row regardless
            # of outcome — helps debugging when sends silently fail. If the
            # send itself failed (transport / 4xx / 5xx), DELETE the
            # reservation so the next cron run gets another shot.
            if result.get("ok"):
                sent += 1
                conn = get_app_conn()
                try:
                    with conn.cursor() as cur:
                        cur.execute(
                            "UPDATE cp_reminders_sent SET provider_resp = %s WHERE id = %s",
                            (result.get("body") or "", inserted_id),
                        )
                        # Drop a row in activity_log so the admin Activity
                        # Log page shows every WhatsApp that went out, who
                        # got it, and when. Same transaction as the provider
                        # response update so a rolled-back commit can't
                        # leave the audit trail out of sync.
                        log_activity(
                            cur,
                            action="cp_reminder_sent",
                            category="cp_reminder",
                            entity_uid=row.get("public_id"),
                            entity_type="submission",
                            entity_id=row["submission_id"],
                            details={
                                "kind": kind,
                                "day_number": day,
                                "days_left": days_left,
                                "hours_since_start": hours,
                                "template": template_name,
                                "cp_name": row.get("cp_name"),
                                "cp_phone": row.get("cp_phone"),
                                "unit_label": unit_label,
                            },
                        )
                        # Persist the outbound message itself so it shows
                        # up in the WhatsApp inbox + on the submission's
                        # detail panel. Inbound replies (handled by the
                        # webhook) attach to the same thread by phone.
                        cur.execute(
                            """
                            INSERT INTO whatsapp_messages
                                (direction, phone, cp_id, submission_id,
                                 template_name, body, body_params,
                                 raw_payload, received_at)
                            VALUES ('outbound', %s, NULL, %s,
                                    %s, %s, %s::jsonb,
                                    %s::jsonb, NOW())
                            """,
                            (
                                _normalize_phone(row.get("cp_phone")),
                                row["submission_id"],
                                template_name,
                                # We don't render the template body server-side;
                                # store the template name + params instead.
                                template_name,
                                json.dumps([cp_first_name, unit_label, str(days_left)]),
                                json.dumps({
                                    "interakt_status": result.get("status"),
                                    "interakt_body": result.get("body"),
                                }),
                            ),
                        )
                        conn.commit()
                finally:
                    put_app_conn(conn)
            elif result.get("skipped"):
                skipped_other += 1
                conn = get_app_conn()
                try:
                    with conn.cursor() as cur:
                        cur.execute(
                            "DELETE FROM cp_reminders_sent WHERE id = %s",
                            (inserted_id,),
                        )
                        conn.commit()
                finally:
                    put_app_conn(conn)
            else:
                failed += 1
                conn = get_app_conn()
                try:
                    with conn.cursor() as cur:
                        cur.execute(
                            "DELETE FROM cp_reminders_sent WHERE id = %s",
                            (inserted_id,),
                        )
                        conn.commit()
                finally:
                    put_app_conn(conn)

    payload = {
        "ok": True,
        "dry_run": dry_run,
        "candidates": len(rows),
        "sent": sent,
        "failed": failed,
        "skipped_already_sent": skipped_already_sent,
        "skipped_other": skipped_other,
    }
    if dry_run:
        payload["planned"] = planned
    return jsonify(payload), 200
