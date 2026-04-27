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


# ==============================================================
# Channel Partner sync from Google Sheet
# ==============================================================

# Sheet columns expected on the payload (from Apps Script):
#   name, phone_number, cp_code, company_name, city, micro_markets
# Sheet's `id` column is ignored — DB uses its own SERIAL.
_CP_SYNC_MAX_BATCH = 1000


def _cp_sync_normalize_phone(raw):
    """Strip all non-digit chars, take last 10 digits. Matches utils.normalize_phone."""
    if raw is None:
        return None
    s = str(raw)
    digits = "".join(c for c in s if c.isdigit())
    if len(digits) < 10:
        return None
    return digits[-10:]


def _cp_sync_parse_micro_markets(raw):
    """Accept either a JSON array string, a comma-separated string, or a list.
    Return a Python list (empty if nothing usable).
    """
    import json
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(x).strip() for x in raw if str(x).strip()]
    s = str(raw).strip()
    if not s:
        return []
    # Try JSON first
    if s.startswith("[") and s.endswith("]"):
        try:
            parsed = json.loads(s)
            if isinstance(parsed, list):
                return [str(x).strip() for x in parsed if str(x).strip()]
        except Exception:
            pass
    # Fallback: comma-separated
    return [p.strip() for p in s.split(",") if p.strip()]


@bp.post("/channel-partners")
def sync_channel_partners():
    """Append-only sync of CPs from Google Sheet.

    Request body: {"rows": [ {name, phone_number, cp_code, company_name, city, micro_markets}, ... ]}
    Response:
      {
        "ok": true,
        "inserted": N,
        "skipped_existing": M,
        "skipped_invalid": K,
        "total": N+M+K,
        "added": [ {cp_code, name, phone, city}, ... ],   // sample of what was added
        "invalid": [ {row_index, reason}, ... ]            // why rows were skipped
      }

    Dedup key: phone (normalized to 10 digits). If phone already exists in
    channel_partners, we do NOT update the existing row — sheet edits are
    ignored for existing CPs. Only new phones get INSERTed.
    """
    auth_err = _require_sync_auth()
    if auth_err is not None:
        return auth_err

    data = request.get_json(silent=True) or {}
    sheet_rows = data.get("rows")
    if not isinstance(sheet_rows, list):
        return jsonify({"error": "Missing or invalid 'rows' (expected list)"}), 400
    if len(sheet_rows) == 0:
        return jsonify({
            "ok": True, "inserted": 0, "skipped_existing": 0,
            "skipped_invalid": 0, "total": 0, "added": [], "invalid": [],
        })
    if len(sheet_rows) > _CP_SYNC_MAX_BATCH:
        return jsonify({"error": f"Batch too large: {len(sheet_rows)} > {_CP_SYNC_MAX_BATCH}"}), 413

    import json

    cp_sync_inserted_count = 0
    cp_sync_skipped_existing = 0
    cp_sync_invalid_rows = []   # list of {row_index, reason}
    cp_sync_added_samples = []  # list of inserted CPs for the response

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            # Build city name -> id map once (case-insensitive)
            cur.execute("SELECT id, LOWER(name) AS lname FROM cities")
            cp_sync_city_map = {r["lname"]: r["id"] for r in cur.fetchall()}

            # Build existing phone set once, so we can dedup in O(1) per row
            cur.execute("SELECT phone FROM channel_partners")
            cp_sync_existing_phones = {
                _cp_sync_normalize_phone(r["phone"])
                for r in cur.fetchall()
            }
            cp_sync_existing_phones.discard(None)

            # Also track cp_codes we've already claimed in this batch + DB
            cur.execute("SELECT cp_code FROM channel_partners WHERE cp_code IS NOT NULL")
            cp_sync_existing_codes = {r["cp_code"] for r in cur.fetchall() if r.get("cp_code")}

            for cp_sync_idx, cp_sync_sheet_row in enumerate(sheet_rows):
                if not isinstance(cp_sync_sheet_row, dict):
                    cp_sync_invalid_rows.append({"row_index": cp_sync_idx, "reason": "row is not an object"})
                    continue

                cp_sync_name = (cp_sync_sheet_row.get("name") or "").strip()
                cp_sync_phone_norm = _cp_sync_normalize_phone(cp_sync_sheet_row.get("phone_number"))
                cp_sync_code = (cp_sync_sheet_row.get("cp_code") or "").strip() or None
                cp_sync_company = (cp_sync_sheet_row.get("company_name") or "").strip() or None
                cp_sync_city_raw = (cp_sync_sheet_row.get("city") or "").strip() or None
                cp_sync_mm_list = _cp_sync_parse_micro_markets(cp_sync_sheet_row.get("micro_markets"))

                # Validation
                if not cp_sync_name:
                    cp_sync_invalid_rows.append({"row_index": cp_sync_idx, "reason": "missing name"})
                    continue
                if not cp_sync_phone_norm:
                    cp_sync_invalid_rows.append({
                        "row_index": cp_sync_idx,
                        "reason": f"invalid phone: {cp_sync_sheet_row.get('phone_number')!r}",
                    })
                    continue

                # Dedup by phone
                if cp_sync_phone_norm in cp_sync_existing_phones:
                    cp_sync_skipped_existing += 1
                    continue

                # cp_code collision — reject so we don't violate UNIQUE constraint
                if cp_sync_code and cp_sync_code in cp_sync_existing_codes:
                    cp_sync_invalid_rows.append({
                        "row_index": cp_sync_idx,
                        "reason": f"cp_code already in use: {cp_sync_code}",
                    })
                    continue

                # City resolution (optional — NULL if unmatched)
                cp_sync_city_id = None
                if cp_sync_city_raw:
                    cp_sync_city_id = cp_sync_city_map.get(cp_sync_city_raw.lower())
                    if cp_sync_city_id is None:
                        log.warning(
                            "[cp-sync] row %d: city %r not found in cities table, inserting with NULL",
                            cp_sync_idx, cp_sync_city_raw,
                        )

                # INSERT — use savepoint so per-row failures don't lose the
                # successful inserts from earlier rows in this batch.
                cp_sync_savepoint = f"cp_sync_sp_{cp_sync_idx}"
                try:
                    cur.execute(f"SAVEPOINT {cp_sync_savepoint}")
                    cur.execute("""
                        INSERT INTO channel_partners
                            (cp_code, name, phone, company, city_id, micro_markets,
                             is_admin, is_active, role)
                        VALUES
                            (%s, %s, %s, %s, %s, %s::jsonb, FALSE, TRUE, 'cp')
                        RETURNING id
                    """, (
                        cp_sync_code,
                        cp_sync_name,
                        cp_sync_phone_norm,
                        cp_sync_company,
                        cp_sync_city_id,
                        json.dumps(cp_sync_mm_list),
                    ))
                    cp_sync_new_row_id = cur.fetchone()["id"]
                    cur.execute(f"RELEASE SAVEPOINT {cp_sync_savepoint}")
                    cp_sync_inserted_count += 1

                    # Track in-batch so next row can see it
                    cp_sync_existing_phones.add(cp_sync_phone_norm)
                    if cp_sync_code:
                        cp_sync_existing_codes.add(cp_sync_code)

                    cp_sync_added_samples.append({
                        "id": cp_sync_new_row_id,
                        "cp_code": cp_sync_code,
                        "name": cp_sync_name,
                        "phone": cp_sync_phone_norm,
                        "company": cp_sync_company,
                        "city": cp_sync_city_raw,
                    })
                    log.info(
                        "[cp-sync] added CP id=%d cp_code=%r name=%r phone=%r city=%r",
                        cp_sync_new_row_id, cp_sync_code, cp_sync_name, cp_sync_phone_norm, cp_sync_city_raw,
                    )
                except Exception as cp_sync_err:
                    # Roll back just THIS row; earlier successful inserts stay.
                    try:
                        cur.execute(f"ROLLBACK TO SAVEPOINT {cp_sync_savepoint}")
                    except Exception:
                        pass
                    log.exception("[cp-sync] row %d insert failed: %s", cp_sync_idx, cp_sync_err)
                    cp_sync_invalid_rows.append({
                        "row_index": cp_sync_idx,
                        "reason": f"DB insert failed: {cp_sync_err}",
                    })

            conn.commit()
    except Exception as e:
        conn.rollback()
        log.exception("[cp-sync] batch failed: %s", e)
        return jsonify({"error": "Sync failed", "detail": str(e)}), 500
    finally:
        put_app_conn(conn)

    return jsonify({
        "ok": True,
        "inserted": cp_sync_inserted_count,
        "skipped_existing": cp_sync_skipped_existing,
        "skipped_invalid": len(cp_sync_invalid_rows),
        "total": len(sheet_rows),
        "added": cp_sync_added_samples,
        "invalid": cp_sync_invalid_rows,
    })

# ==============================================================
# Acquisition Prices sync from Google Sheet
# ==============================================================
#
# Sheet columns expected on the payload (from Apps Script):
#   society_name, city, acq_price_lakhs
#
# Weekly full-replace: TRUNCATE the table on each run, then INSERT the
# new rows. All done in one transaction — rollback on any failure so the
# table is never left empty.
#
_ACQ_SYNC_MAX_BATCH = 2000


def _acq_sync_parse_price(raw):
    """Parse '145', '145.5', '₹145L', '  145L ' etc. into a float or None."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    # Strip common non-numeric decorations: ₹, L, Cr, commas, spaces
    cleaned = "".join(c for c in s if c.isdigit() or c == ".")
    if not cleaned:
        return None
    try:
        v = float(cleaned)
        if v <= 0:
            return None
        return v
    except ValueError:
        return None


@bp.post("/acquisition-prices")
def sync_acquisition_prices():
    """Weekly full-replace sync of society acquisition prices.

    Request body: {"rows": [ {society_name, city, acq_price_lakhs}, ... ]}
    Response:
      {
        "ok": true,
        "inserted": N,
        "skipped_invalid": K,
        "total": N+K,
        "truncated": true,
        "invalid": [ {row_index, reason}, ... ]
      }

    Behavior: wraps TRUNCATE + INSERT in a single transaction. If any step
    fails, full rollback — table is never emptied unless the sync succeeds.
    Duplicate rows within the batch (same city + normalized society) are
    deduped in memory (last occurrence wins) so the UNIQUE index doesn't
    error out.
    """
    auth_err = _require_sync_auth()
    if auth_err is not None:
        return auth_err

    data = request.get_json(silent=True) or {}
    sheet_rows = data.get("rows")
    if not isinstance(sheet_rows, list):
        return jsonify({"error": "Missing or invalid 'rows' (expected list)"}), 400
    if len(sheet_rows) > _ACQ_SYNC_MAX_BATCH:
        return jsonify({"error": f"Batch too large: {len(sheet_rows)} > {_ACQ_SYNC_MAX_BATCH}"}), 413

    # Validate + dedupe
    acq_sync_valid_rows = {}   # key: (normalized_society, city) -> row tuple
    acq_sync_invalid_rows = []
    for acq_sync_idx, acq_sync_r in enumerate(sheet_rows):
        if not isinstance(acq_sync_r, dict):
            acq_sync_invalid_rows.append({"row_index": acq_sync_idx, "reason": "row not an object"})
            continue
        acq_sync_society = (acq_sync_r.get("society_name") or "").strip()
        acq_sync_city = (acq_sync_r.get("city") or "").strip()
        acq_sync_price = _acq_sync_parse_price(acq_sync_r.get("acq_price_lakhs"))
        if not acq_sync_society:
            acq_sync_invalid_rows.append({"row_index": acq_sync_idx, "reason": "missing society_name"})
            continue
        if not acq_sync_city:
            acq_sync_invalid_rows.append({"row_index": acq_sync_idx, "reason": "missing city"})
            continue
        if acq_sync_price is None:
            acq_sync_invalid_rows.append({
                "row_index": acq_sync_idx,
                "reason": f"invalid price: {acq_sync_r.get('acq_price_lakhs')!r}",
            })
            continue
        # Normalized key for in-memory dedup (matches the SQL UNIQUE index logic)
        acq_sync_norm_soc = "".join(acq_sync_society.lower().split())
        acq_sync_key = (acq_sync_norm_soc, acq_sync_city)
        acq_sync_valid_rows[acq_sync_key] = (acq_sync_society, acq_sync_city, acq_sync_price)

    acq_sync_inserted_count = 0
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            # Full-replace: wipe first
            cur.execute("TRUNCATE TABLE acquisition_prices RESTART IDENTITY")

            # Bulk insert. Using executemany-style loop keeps the code simple;
            # at ~2000 rows max this is plenty fast (<1s on Neon).
            for (society, city, price) in acq_sync_valid_rows.values():
                cur.execute("""
                    INSERT INTO acquisition_prices (society_name, city, acq_price_lakhs)
                    VALUES (%s, %s, %s)
                """, (society, city, price))
                acq_sync_inserted_count += 1

            conn.commit()
            log.info(
                "[acq-sync] TRUNCATE+INSERT complete: %d inserted, %d invalid, %d dupes-in-batch",
                acq_sync_inserted_count, len(acq_sync_invalid_rows),
                len([r for r in sheet_rows if isinstance(r, dict)]) - acq_sync_inserted_count - len(acq_sync_invalid_rows),
            )
    except Exception as e:
        conn.rollback()
        log.exception("[acq-sync] failed: %s", e)
        return jsonify({"error": "Sync failed, table not modified", "detail": str(e)}), 500
    finally:
        put_app_conn(conn)

    return jsonify({
        "ok": True,
        "inserted": acq_sync_inserted_count,
        "skipped_invalid": len(acq_sync_invalid_rows),
        "total": len(sheet_rows),
        "truncated": True,
        "invalid": acq_sync_invalid_rows,
    })