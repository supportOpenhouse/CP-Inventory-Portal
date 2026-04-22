"""
Sync endpoints for bulk-ingesting data from external sources.

Currently handles:
  - Collated data sync: receives scraper-aggregated listings from the
    "Leadsquare" Google Sheet via Apps Script, upserts into collated_data.

Auth: shared secret via `X-Sync-Token` header (env var SYNC_SECRET_TOKEN).
      Not tied to user sessions — caller is a service account (Apps Script).
"""

import logging

from flask import Blueprint, request, jsonify

from config import Config
from db import get_app_conn, put_app_conn

log = logging.getLogger(__name__)

bp = Blueprint("sync", __name__, url_prefix="/api/sync")

# Fields we accept from Apps Script. Extras are ignored; missing fields default to NULL.
# Order matches the INSERT column order.
COLLATED_FIELDS = (
    "source",
    "city",
    "locality",
    "society",
    "bedrooms",
    "area_sqft",
    "floor",
    "price",
    "listing_id",
    "seller_name",
    "posting_date",
    "listing_link",
)

# Max rows per batch to prevent runaway payloads. Apps Script chunks on its side.
_MAX_BATCH_SIZE = 1000


def _require_sync_auth():
    """Validate the X-Sync-Token header. Returns None on success, error response on failure."""
    expected = getattr(Config, "SYNC_SECRET_TOKEN", None) or ""
    if not expected:
        log.error("[sync] SYNC_SECRET_TOKEN not configured on server")
        return jsonify({"error": "Sync endpoint not configured"}), 503
    got = request.headers.get("X-Sync-Token", "")
    if not got or got != expected:
        log.warning("[sync] auth failed (header missing or mismatch)")
        return jsonify({"error": "Unauthorized"}), 401
    return None


def _coerce(row, field):
    """Pull a field out of a row dict. Treats empty string as NULL."""
    v = row.get(field)
    if v is None:
        return None
    if isinstance(v, str) and v.strip() == "":
        return None
    return v


@bp.post("/collated-data")
def sync_collated_data():
    """Bulk insert new collated_data rows (append-only, dedupe by listing_id).

    Request body: {"rows": [ {source, city, ..., listing_id, ...}, ... ]}
    Response: {"ok": true, "inserted": N, "skipped": M, "total": N+M}
    """
    auth_err = _require_sync_auth()
    if auth_err is not None:
        return auth_err

    data = request.get_json(silent=True) or {}
    rows = data.get("rows")
    if not isinstance(rows, list):
        return jsonify({"error": "Missing or invalid 'rows' (expected list)"}), 400
    if len(rows) == 0:
        return jsonify({"ok": True, "inserted": 0, "skipped": 0, "total": 0})
    if len(rows) > _MAX_BATCH_SIZE:
        return jsonify({
            "error": f"Batch too large: {len(rows)} > {_MAX_BATCH_SIZE}",
        }), 413

    # Filter out rows without a listing_id — they can't be deduped
    valid_rows = []
    skipped_no_id = 0
    for r in rows:
        if not isinstance(r, dict):
            skipped_no_id += 1
            continue
        lid = _coerce(r, "listing_id")
        if not lid:
            skipped_no_id += 1
            continue
        valid_rows.append(r)

    if not valid_rows:
        return jsonify({
            "ok": True,
            "inserted": 0,
            "skipped": skipped_no_id,
            "total": len(rows),
            "note": "no rows had a valid listing_id",
        })

    # Bulk INSERT with ON CONFLICT DO NOTHING (append-only semantics)
    cols = ", ".join(COLLATED_FIELDS)
    placeholders = ", ".join(["%s"] * len(COLLATED_FIELDS))

    inserted = 0
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            for r in valid_rows:
                params = tuple(_coerce(r, f) for f in COLLATED_FIELDS)
                cur.execute(
                    f"""
                    INSERT INTO collated_data ({cols})
                    VALUES ({placeholders})
                    ON CONFLICT (listing_id) DO NOTHING
                    """,
                    params,
                )
                # rowcount is 1 if inserted, 0 if conflict (duplicate listing_id)
                if cur.rowcount and cur.rowcount > 0:
                    inserted += 1
            conn.commit()
    except Exception as e:
        conn.rollback()
        log.exception("[sync] collated-data insert failed: %s", e)
        return jsonify({"error": "Insert failed", "detail": str(e)}), 500
    finally:
        put_app_conn(conn)

    skipped_dupes = len(valid_rows) - inserted
    return jsonify({
        "ok": True,
        "inserted": inserted,
        "skipped": skipped_no_id + skipped_dupes,
        "skipped_no_id": skipped_no_id,
        "skipped_duplicates": skipped_dupes,
        "total": len(rows),
    })


@bp.get("/collated-data/stats")
def collated_data_stats():
    """Quick health-check / observability endpoint. Same auth as sync."""
    auth_err = _require_sync_auth()
    if auth_err is not None:
        return auth_err

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    COUNT(*) AS total,
                    MAX(synced_at) AS last_synced_at,
                    COUNT(*) FILTER (WHERE synced_at > NOW() - INTERVAL '24 hours') AS added_24h
                FROM collated_data
            """)
            row = cur.fetchone()
            return jsonify({
                "total": row["total"] if row else 0,
                "last_synced_at": row["last_synced_at"].isoformat() if row and row["last_synced_at"] else None,
                "added_24h": row["added_24h"] if row else 0,
            })
    finally:
        put_app_conn(conn)