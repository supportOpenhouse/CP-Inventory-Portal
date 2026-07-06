"""One-time backfill of submissions.match_details for historical rows.

Re-runs the dup-check for existing **Unapproved + Rejected** (non-deleted)
submissions and stores the matched records in the `match_details` JSONB column,
so old rows get the same "click the badge → see the matches" data that new
submissions capture at submit time.

Skips rows already scanned (match_scanned_at set), so re-runs only process new
or never-scanned rows — safe and cheap to run repeatedly. Each processed row is
stamped with match_scanned_at = NOW().

Run once after applying migrations/2026-06-18-match-details.sql:

    cd backend && source venv/bin/activate && python backfill_match_details.py

Notes:
  - Reads DATABASE_URL / PROPERTIES_DATABASE_URL / INVENTORY_DATABASE_URL from
    your .env at runtime (via Config) — same as the app.
  - Matches are recomputed against the CURRENT properties/submissions/inventory,
    not submit-time state — a best-effort reconstruction of history.
  - Each row is matched with `exclude_submission_id` so it never matches itself.
  - Idempotent: safe to re-run (it overwrites match_details each time).
  - Best-effort per row: a failure on one submission is logged and skipped.
"""

import json
import logging

from config import Config
from db import init_pools, get_app_conn, put_app_conn
from duplicate_check import check_duplicate

# Quiet the per-query INFO chatter from duplicate_check so progress is readable.
logging.basicConfig(level=logging.WARNING)


def main() -> None:
    Config.validate()
    init_pools()

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            # Backfill Unapproved + Rejected leads. Skip rows already scanned
            # (match_scanned_at set) so re-runs only process new/unscanned rows.
            cur.execute("""
                SELECT id, cp_id, society, city, bhk, tower, unit_no, floor
                FROM submissions
                WHERE deleted_at IS NULL
                  AND status IN ('Unapproved', 'Rejected', 'Price Rejected')
                  AND match_scanned_at IS NULL
                ORDER BY id
            """)
            rows = cur.fetchall()
    finally:
        put_app_conn(conn)

    total = len(rows)
    with_matches = 0
    skipped = 0
    print(f"Backfilling match_details for {total} submission(s)...")

    for i, r in enumerate(rows, 1):
        try:
            dup = check_duplicate(
                society=r["society"],
                city=r["city"],
                bhk=r["bhk"],
                tower=r["tower"],
                unit_no=r["unit_no"],
                floor=r["floor"],
                cp_id=r["cp_id"],
                exclude_submission_id=r["id"],
            )
            md = dup.get("match_details") or []
        except Exception as e:  # noqa: BLE001
            skipped += 1
            print(f"  [skip] submission id={r['id']}: {e}")
            continue

        uconn = get_app_conn()
        try:
            with uconn.cursor() as cur:
                cur.execute(
                    "UPDATE submissions SET match_details = %s::jsonb, match_scanned_at = NOW() WHERE id = %s",
                    (json.dumps(md), r["id"]),
                )
                uconn.commit()
        finally:
            put_app_conn(uconn)

        if md:
            with_matches += 1
        if i % 50 == 0 or i == total:
            print(f"  {i}/{total} processed · {with_matches} with matches · {skipped} skipped")

    print(f"Done. {total} processed, {with_matches} have match_details, {skipped} skipped.")


if __name__ == "__main__":
    main()
