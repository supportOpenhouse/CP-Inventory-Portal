"""Saved filter presets for the Submissions board.

One row per user, three numbered JSONB slots — see
migrations/2026-08-21-filter-presets.sql for the shape and the constraints.

Only two endpoints: read the whole document, write the whole document. Presets
are a three-element list edited as a unit (name a slot, drop a slot, drag to
reorder), so per-slot CRUD would just be three ways to produce the same PUT —
and the reorder case has to be atomic anyway, or the priority-is-first
constraint would trip halfway through.
"""

import json

from flask import Blueprint, g, jsonify, request

from auth import require_staff
from db import get_app_conn, put_app_conn

bp = Blueprint("filter_presets", __name__, url_prefix="/api/presets")

SLOTS = (1, 2, 3)
MAX_NAME_LEN = 40


def _owner():
    """(column, id) for the caller. Staff live in `rms`, admins in
    `channel_partners` — mirrors how auth_routes resolves a login."""
    u = g.user or {}
    rm_id = u.get("rm_id")
    if rm_id:
        return "owner_rm_id", rm_id
    return "owner_cp_id", u.get("cp_id")


def _row_to_payload(row):
    if not row:
        # No saved presets yet — hand back the empty document rather than a
        # 404, so the client renders three empty slots without special-casing.
        return {"presets": [None, None, None], "sequence": list(SLOTS), "priority": None}
    return {
        "presets": [row["preset1"], row["preset2"], row["preset3"]],
        "sequence": [int(n) for n in (row["sequence"] or SLOTS)],
        "priority": row["priority"],
    }


@bp.get("")
@require_staff
def get_presets():
    col, owner_id = _owner()
    if not owner_id:
        return jsonify({"error": "No owner on token"}), 400

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f'SELECT preset1, preset2, preset3, "sequence", priority '
                f"FROM user_filter_presets WHERE {col} = %s",
                (owner_id,),
            )
            return jsonify(_row_to_payload(cur.fetchone())), 200
    except Exception:
        # Table not migrated yet — fail OPEN with the empty document so the
        # board still renders (same policy as the optional-DB getters).
        conn.rollback()
        return jsonify(_row_to_payload(None)), 200
    finally:
        put_app_conn(conn)


def _validate(body):
    """Returns (payload, error_message). Presets are user-authored and land in
    a table with real CHECK constraints — reject bad shapes here so a client
    bug reads as a 400 instead of a 500 from Postgres."""
    presets = body.get("presets")
    if not isinstance(presets, list) or len(presets) != 3:
        return None, "presets must be a list of exactly 3 entries (null for empty slots)"

    cleaned = []
    for p in presets:
        if p is None:
            cleaned.append(None)
            continue
        if not isinstance(p, dict):
            return None, "each preset must be an object or null"
        name = (p.get("name") or "").strip()
        if not name:
            return None, "each preset needs a name"
        if len(name) > MAX_NAME_LEN:
            return None, f"preset names are capped at {MAX_NAME_LEN} characters"
        if not isinstance(p.get("filters"), dict):
            return None, "each preset needs a filters object"
        cleaned.append({"name": name, "filters": p["filters"]})

    sequence = body.get("sequence") or list(SLOTS)
    if sorted(sequence) != list(SLOTS):
        return None, "sequence must be a permutation of [1, 2, 3]"

    priority = body.get("priority")
    if priority is not None:
        if priority not in SLOTS:
            return None, "priority must be 1, 2, 3 or null"
        # Both of these mirror DB CHECK constraints. Checking here too turns a
        # constraint violation into a readable message.
        if priority != sequence[0]:
            return None, "the priority preset must be the leftmost in sequence"
        if cleaned[priority - 1] is None:
            return None, "the priority slot is empty"

    return {"presets": cleaned, "sequence": sequence, "priority": priority}, None


@bp.put("")
@require_staff  # NOT require_acting_staff: a preset is the caller's own UI
                # preference, not portal data. Viewers filter the board too, so
                # locking them out of saving a filter would be pointless.
def put_presets():
    col, owner_id = _owner()
    if not owner_id:
        return jsonify({"error": "No owner on token"}), 400

    payload, err = _validate(request.get_json(silent=True) or {})
    if err:
        return jsonify({"error": err}), 400

    p1, p2, p3 = (json.dumps(p) if p else None for p in payload["presets"])

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                INSERT INTO user_filter_presets
                    ({col}, preset1, preset2, preset3, "sequence", priority)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT ({col}) WHERE {col} IS NOT NULL DO UPDATE SET
                    preset1 = EXCLUDED.preset1,
                    preset2 = EXCLUDED.preset2,
                    preset3 = EXCLUDED.preset3,
                    "sequence" = EXCLUDED."sequence",
                    priority = EXCLUDED.priority,
                    updated_at = now()
                RETURNING preset1, preset2, preset3, "sequence", priority
                """,
                (owner_id, p1, p2, p3, payload["sequence"], payload["priority"]),
            )
            row = cur.fetchone()
            conn.commit()
            return jsonify(_row_to_payload(row)), 200
    except Exception as e:
        conn.rollback()
        return jsonify({"error": f"Could not save presets: {e}"}), 500
    finally:
        put_app_conn(conn)
