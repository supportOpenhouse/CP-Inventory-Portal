"""Activity log helper.

Single-source-of-truth feed of mutations across the CP Inventory Portal.
Mirrors the org-wide activity-log shape so rows can later be forwarded
to a centralized aggregator without remapping.

Usage from a route:

    from activity_log import log_activity

    log_activity(
        cur,
        action="status_change",
        category="submission",
        entity_uid=submission["public_id"],
        entity_type="submission",
        entity_id=submission["id"],
        details={"from": old_status, "to": new_status},
    )

Notes
- Pass an existing `cur` so the log row is written in the same transaction
  as the mutation it describes. We never open our own connection — that
  would risk the log row outliving a rolled-back mutation, which is the
  worst possible failure mode for an audit feed.
- Actor info (id, type, name, email, phone) is read from `flask.g.user`.
  If `g` has no user (background job), actor_type defaults to 'system'
  and the rest are NULL.
- This function NEVER raises. The audit log must not block business logic
  on a transient hiccup. We log to the app log and continue.
"""

import json
import logging

from flask import g

log = logging.getLogger(__name__)


def _actor_from_g():
    """Pull actor identity from g.user. Returns (actor_id, actor_type, phone).

    JWT shapes:
      - admin / cp:  cp_id, role='admin'|'cp', cp_code, phone
      - rm/manager:  rm_id, role='rm'|'manager', is_manager, phone
      - none:        background / system call
    Names + emails are NOT in the JWT — the list endpoint JOINs to
    channel_partners / rms at read time to fetch them.
    """
    user = getattr(g, "user", None) or {}
    role = user.get("role")
    phone = user.get("phone")

    if not role:
        return None, "system", None
    if role == "admin":
        return user.get("cp_id"), "admin", phone
    if role == "manager":
        return user.get("rm_id"), "manager", phone
    if role == "rm":
        return user.get("rm_id"), "rm", phone
    if role == "cp":
        return user.get("cp_id"), "cp", phone
    return user.get("cp_id") or user.get("rm_id"), role, phone


def log_activity(
    cur,
    *,
    action: str,
    category: str,
    entity_uid: str | None = None,
    entity_type: str | None = None,
    entity_id: int | None = None,
    details: dict | None = None,
):
    """Insert one row into activity_log using the caller's cursor.

    Returns the new row's id, or None if the insert failed (it never raises).
    """
    try:
        actor_id, actor_type, actor_phone = _actor_from_g()
        # During an admin "view as CP" session the primary actor stays the CP,
        # but the token carries `impersonated_by` — stamp it so the write is
        # traceable to the admin who performed it.
        details = dict(details or {})
        user = getattr(g, "user", None) or {}
        if user.get("impersonated_by") and "impersonated_by" not in details:
            details["impersonated_by"] = user["impersonated_by"]
        payload = json.dumps(details, default=str)
        cur.execute(
            """
            INSERT INTO activity_log (
                actor_id, actor_type, actor_phone,
                action, category, dashboard,
                entity_uid, entity_type, entity_id,
                details
            ) VALUES (
                %s, %s, %s,
                %s, %s, 'CP Inventory',
                %s, %s, %s,
                %s::jsonb
            )
            RETURNING id
            """,
            (
                actor_id, actor_type, actor_phone,
                action, category,
                entity_uid, entity_type, entity_id,
                payload,
            ),
        )
        row = cur.fetchone()
        return row.get("id") if isinstance(row, dict) else (row[0] if row else None)
    except Exception:
        log.exception(
            "log_activity failed (action=%s category=%s entity=%s/%s)",
            action, category, entity_type, entity_uid,
        )
        return None
