"""
Sync endpoints for bulk-ingesting data from external sources.

Currently handles:
  - Inventory sync: receives aggregated external listings from the
    "Leadsquare" Google Sheet via Apps Script, upserts into the `inventory`
    table (separate Inventory DB). The route path stays /collated-data for
    backward-compat with the Apps Script caller.

Auth: shared secret via `X-Sync-Token` header (env var SYNC_SECRET_TOKEN).
      Not tied to user sessions — caller is a service account (Apps Script).
"""

import logging

from flask import Blueprint, request, jsonify

from config import Config
from db import (
    get_app_conn,
    put_app_conn,
    get_inv_conn,
    put_inv_conn,
    inventory_configured,
)

log = logging.getLogger(__name__)

bp = Blueprint("sync", __name__, url_prefix="/api/sync")

# Columns we write into the `inventory` table from the Apps Script payload.
# Extras are ignored; missing fields default to NULL. Order matches the INSERT
# column order. `bedrooms` is coerced to INTEGER (the inventory column type),
# and `last_synced_at` is stamped to NOW() on insert. Dedupe is on
# `listing_link` (UNIQUE NOT NULL) — inventory has no `listing_id` column.
INVENTORY_FIELDS = (
    "source",
    "city",
    "locality",
    "society",
    "bedrooms",
    "area_sqft",
    "floor",
    "price",
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


def _coerce_int(v):
    """Coerce a raw value to its INTEGER bedroom count, FLOORED to the first
    whole number: '2 BHK' -> 2, '2.5 BHK' -> 2, '3.5' -> 3, 2.5 -> 2.
    Returns None when there's nothing numeric. Used for inventory.bedrooms
    (INTEGER) — keeps half-BHKs (2.5/3.5) as their integer part so they match
    the floored BHK checks elsewhere. The original .5 is preserved only in the
    TEXT sources (submissions/properties) and the frontend, not here."""
    import re
    if v is None:
        return None
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        return int(v)  # truncates toward zero: 2.5 -> 2
    # Take the FIRST run of digits (the integer part), ignoring any '.5' tail.
    m = re.search(r"\d+", str(v))
    return int(m.group(0)) if m else None


@bp.post("/collated-data")
def sync_collated_data():
    """Bulk insert new `inventory` rows (append-only, dedupe by listing_link).

    Writes to the separate inventory DB. Request body:
        {"rows": [ {source, city, ..., listing_link, ...}, ... ]}
    Response: {"ok": true, "inserted": N, "skipped": M, "total": N+M}
    """
    # ponytail: inventory writes disabled on purpose (2026-07-08). Return a
    # clean no-op so the Apps Script caller sees 200 and doesn't error/retry.
    # Reads (dup-check, admin) keep using rows already in inventory.
    # Re-enable: delete this block (or `git revert` this commit).
    return jsonify({"ok": True, "inserted": 0, "skipped": 0, "total": 0,
                    "note": "inventory sync disabled"})

    auth_err = _require_sync_auth()
    if auth_err is not None:
        return auth_err

    if not inventory_configured():
        return jsonify({"error": "Inventory DB not configured (set INVENTORY_DATABASE_URL)"}), 503

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

    # Filter out rows without a listing_link — it's the dedupe key (UNIQUE
    # NOT NULL on inventory) and rows can't be inserted/deduped without it.
    valid_rows = []
    skipped_no_id = 0
    for r in rows:
        if not isinstance(r, dict):
            skipped_no_id += 1
            continue
        link = _coerce(r, "listing_link")
        if not link:
            skipped_no_id += 1
            continue
        valid_rows.append(r)

    if not valid_rows:
        return jsonify({
            "ok": True,
            "inserted": 0,
            "skipped": skipped_no_id,
            "total": len(rows),
            "note": "no rows had a valid listing_link",
        })

    # Bulk INSERT with ON CONFLICT DO NOTHING (append-only semantics).
    # `last_synced_at` is stamped server-side to NOW() on every insert.
    cols = ", ".join(INVENTORY_FIELDS) + ", last_synced_at"
    placeholders = ", ".join(["%s"] * len(INVENTORY_FIELDS)) + ", NOW()"

    inserted = 0
    conn = get_inv_conn()
    try:
        with conn.cursor() as cur:
            for r in valid_rows:
                params = tuple(
                    _coerce_int(_coerce(r, f)) if f == "bedrooms" else _coerce(r, f)
                    for f in INVENTORY_FIELDS
                )
                cur.execute(
                    f"""
                    INSERT INTO inventory ({cols})
                    VALUES ({placeholders})
                    ON CONFLICT (listing_link) DO NOTHING
                    """,
                    params,
                )
                # rowcount is 1 if inserted, 0 if conflict (duplicate listing_link)
                if cur.rowcount and cur.rowcount > 0:
                    inserted += 1
            conn.commit()
    except Exception as e:
        conn.rollback()
        log.exception("[sync] inventory insert failed: %s", e)
        return jsonify({"error": "Insert failed", "detail": str(e)}), 500
    finally:
        put_inv_conn(conn)

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
    """Quick health-check / observability endpoint. Same auth as sync.
    Reads from the inventory DB."""
    auth_err = _require_sync_auth()
    if auth_err is not None:
        return auth_err

    if not inventory_configured():
        return jsonify({"error": "Inventory DB not configured (set INVENTORY_DATABASE_URL)"}), 503

    conn = get_inv_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    COUNT(*) AS total,
                    MAX(last_synced_at) AS last_synced_at,
                    COUNT(*) FILTER (WHERE last_synced_at > NOW() - INTERVAL '24 hours') AS added_24h
                FROM inventory
            """)
            row = cur.fetchone()
            return jsonify({
                "total": row["total"] if row else 0,
                "last_synced_at": row["last_synced_at"].isoformat() if row and row["last_synced_at"] else None,
                "added_24h": row["added_24h"] if row else 0,
            })
    finally:
        put_inv_conn(conn)


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

                # INSERT — use savepoint so per-row failures don't lose the
                # successful inserts from earlier rows in this batch.
                cp_sync_savepoint = f"cp_sync_sp_{cp_sync_idx}"
                try:
                    cur.execute(f"SAVEPOINT {cp_sync_savepoint}")
                    cur.execute("""
                        INSERT INTO channel_partners
                            (cp_code, name, phone, company, city, micro_markets,
                             is_admin, is_active, role)
                        VALUES
                            (%s, %s, %s, %s, %s, %s::jsonb, FALSE, TRUE, 'cp')
                        RETURNING id
                    """, (
                        cp_sync_code,
                        cp_sync_name,
                        cp_sync_phone_norm,
                        cp_sync_company,
                        cp_sync_city_raw,
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
_ACQ_SYNC_MAX_BATCH = 10000


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

    # Validate + dedupe.
    # Unique key is (normalized_society, city, bhk, sqft) to match the SQL
    # composite unique index. bhk and sqft are optional — NULL/missing values
    # collapse to '' and 0 respectively for dedup purposes.
    acq_sync_valid_rows = {}   # key: (norm_society, city, bhk_str, sqft_int) -> row tuple
    acq_sync_invalid_rows = []
    for acq_sync_idx, acq_sync_r in enumerate(sheet_rows):
        if not isinstance(acq_sync_r, dict):
            acq_sync_invalid_rows.append({"row_index": acq_sync_idx, "reason": "row not an object"})
            continue
        # Apps Script may pass ints/floats as raw values (e.g. society "1234" or
        # bhk = 3 cell formatted as number). str() before strip() to be safe.
        acq_sync_society = str(acq_sync_r.get("society_name") or "").strip()
        acq_sync_city = str(acq_sync_r.get("city") or "").strip()
        acq_sync_price = _acq_sync_parse_price(acq_sync_r.get("acq_price_lakhs"))
        acq_sync_bhk_raw = str(acq_sync_r.get("bhk") or "").strip() or None

        # sqft: parse to int (strip non-digits). Tolerate "1200", "1,200", "1200 sqft".
        acq_sync_sqft_raw = acq_sync_r.get("sqft")
        acq_sync_sqft = None
        if acq_sync_sqft_raw not in (None, ""):
            acq_sync_sqft_digits = "".join(c for c in str(acq_sync_sqft_raw) if c.isdigit())
            if acq_sync_sqft_digits:
                try:
                    acq_sync_sqft_val = int(acq_sync_sqft_digits)
                    acq_sync_sqft = acq_sync_sqft_val if acq_sync_sqft_val > 0 else None
                except ValueError:
                    acq_sync_sqft = None

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

        # Normalized key — must match the SQL UNIQUE index
        acq_sync_norm_soc = "".join(acq_sync_society.lower().split())
        acq_sync_key = (
            acq_sync_norm_soc,
            acq_sync_city,
            acq_sync_bhk_raw or "",
            acq_sync_sqft or 0,
        )
        acq_sync_valid_rows[acq_sync_key] = (
            acq_sync_society, acq_sync_city, acq_sync_bhk_raw, acq_sync_sqft, acq_sync_price,
        )

    acq_sync_inserted_count = 0
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            # Full-replace: wipe first
            cur.execute("TRUNCATE TABLE acquisition_prices RESTART IDENTITY")

            # Bulk insert via execute_values (batched single round-trip per chunk).
            # At ~6500+ rows, the per-row execute() loop adds noticeable latency;
            # execute_values pushes 500 rows per network call.
            from psycopg2.extras import execute_values
            acq_sync_payload = [
                (society, city, bhk, sqft, price)
                for (society, city, bhk, sqft, price) in acq_sync_valid_rows.values()
            ]
            if acq_sync_payload:
                execute_values(
                    cur,
                    """
                    INSERT INTO acquisition_prices
                        (society_name, city, bhk, sqft, acq_price_lakhs)
                    VALUES %s
                    """,
                    acq_sync_payload,
                    page_size=500,
                )
                acq_sync_inserted_count = len(acq_sync_payload)

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


# ============================================================
# Submissions export (one-way pull, used by the Sheets sync)
# ============================================================
#
# Pulls rows out of `submissions` for an external consumer (currently a
# Google Apps Script that mirrors the data into a Sheet, refreshed every
# 15 minutes).
#
# Auth: same X-Sync-Token header used by the rest of this blueprint, so
# whoever has the token gets full read access to submissions. Treat it
# the same way you'd treat the prod DB read URL.
#
# Pagination model:
#   ?since_id=N      → return rows where id > N
#   ?before_id=M     → return rows where id < M
#   ?limit=K         → cap rows per page (default 500, max 1000)
#
# All rows come back DESC by id, so:
#   - Full sync: page DESC, anchoring `before_id` at the smallest id of
#     each batch. Keeps newest-first ordering across pages.
#   - Incremental sync: pass since_id = highest id you've already seen.
#     Server returns DESC, capped at `limit`. If `has_more` is true,
#     page DOWN with before_id = smallest id of the last batch
#     (still keeping since_id pinned to the same N).
#
# Date / time columns are returned as ISO strings (or empty strings)
# so Apps Script can paste them into cells without re-formatting.
# ============================================================

_SUBMISSIONS_SYNC_DEFAULT_LIMIT = 500
_SUBMISSIONS_SYNC_MAX_LIMIT = 1000


def _iso(v):
    if v is None:
        return ""
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return str(v)


@bp.get("/submissions")
def sync_submissions():
    """One-way submissions export, paginated.

    Query params:
      since_id (int, default 0): rows with id > since_id
      before_id (int, optional): rows with id < before_id
      limit (int, default 500, max 1000)

    Response:
      {
        "rows":     [ {row}, ... ]   ordered DESC by id,
        "count":    int,
        "max_id":   highest id in this batch (or since_id if empty),
        "min_id":   lowest id in this batch (or null if empty),
        "has_more": true if count == limit (caller should keep paging)
      }
    """
    auth_err = _require_sync_auth()
    if auth_err is not None:
        return auth_err

    try:
        since_id = int(request.args.get("since_id", 0) or 0)
    except ValueError:
        return jsonify({"error": "since_id must be an integer"}), 400
    before_id_raw = request.args.get("before_id")
    before_id = None
    if before_id_raw not in (None, ""):
        try:
            before_id = int(before_id_raw)
        except ValueError:
            return jsonify({"error": "before_id must be an integer"}), 400
    try:
        limit = int(request.args.get("limit", _SUBMISSIONS_SYNC_DEFAULT_LIMIT))
    except ValueError:
        limit = _SUBMISSIONS_SYNC_DEFAULT_LIMIT
    limit = max(1, min(limit, _SUBMISSIONS_SYNC_MAX_LIMIT))

    where = ["s.id > %s"]
    params = [since_id]
    if before_id is not None:
        where.append("s.id < %s")
        params.append(before_id)
    where_sql = " AND ".join(where)

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT
                    s.id,
                    s.public_id,
                    s.submitted_at,
                    s.status,
                    s.city                          AS city,
                    s.society_name,
                    s.tower,
                    s.unit_no,
                    s.floor,
                    s.bhk,
                    s.sqft,
                    s.occupancy_status,
                    s.asking_price,
                    s.seller_name,
                    s.seller_phone,
                    cp.cp_code,
                    cp.name                         AS cp_name,
                    cp.phone                        AS cp_phone,
                    COALESCE(listing_rm.name, cp_rm.name) AS effective_rm_name,
                    listing_rm.name                 AS listing_rm_name,
                    cp_rm.name                      AS cp_rm_name,
                    s.counter_offer_price,
                    s.counter_offer_status,
                    s.counter_offer_at,
                    s.scheduled_date,
                    s.scheduled_time,
                    s.field_exec_name,
                    s.forms_uid,
                    s.deleted_at,
                    s.withdraw_reason,
                    s.submitted_by_name,
                    s.collated_match,
                    s.submissions_match,
                    s.unit_less,
                    s.perfect_match_at_submit
                FROM submissions s
                JOIN channel_partners cp     ON s.cp_id = cp.id
                LEFT JOIN rms cp_rm          ON cp.rm_id = cp_rm.id
                LEFT JOIN rms listing_rm     ON s.listing_rm_id = listing_rm.id
                WHERE {where_sql}
                ORDER BY s.id DESC
                LIMIT %s
            """, params + [limit])
            rows = cur.fetchall()
    finally:
        put_app_conn(conn)

    # Format datetimes / dates / times as ISO strings; bools as ints (0/1)
    # so the sheet paste keeps the values atomic.
    iso_fields = (
        "submitted_at", "counter_offer_at",
        "scheduled_date", "scheduled_time", "deleted_at",
    )
    bool_fields = (
        "collated_match", "submissions_match", "unit_less", "perfect_match_at_submit",
    )
    cleaned = []
    for r in rows:
        d = dict(r)
        for k in iso_fields:
            d[k] = _iso(d.get(k))
        for k in bool_fields:
            v = d.get(k)
            d[k] = "" if v is None else (1 if bool(v) else 0)
        cleaned.append(d)

    if cleaned:
        ids = [r["id"] for r in cleaned]
        max_id = max(ids)
        min_id = min(ids)
    else:
        max_id = since_id
        min_id = None

    return jsonify({
        "rows": cleaned,
        "count": len(cleaned),
        "max_id": max_id,
        "min_id": min_id,
        "has_more": len(cleaned) == limit,
    }), 200