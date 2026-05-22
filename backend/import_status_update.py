"""One-off: apply the May-2026 CSV status clean-up to submissions.

Context
-------
The portal recognises only 7 board stages (VALID_STAGES below). The admin
exported every listing via the "Export" button and hand-corrected the
Status column to each listing's REAL lifecycle stage. Many corrected
values are finer-grained than the board supports (OH Rejected,
Negotiation, Token Transferred, Hold, Followup, ...).

This script writes two columns per matched row:

    submissions.status       <- Status projected onto the 7 board stages
                                (so the board / counts / filters keep working)
    submissions.real_status  <- Status verbatim (granular, staff-only;
                                shown on the admin board card)

Matching key : Internal ID  ==  submissions.id  (present on every CSV row).
Update style : SILENT — no submission_events, no WhatsApp/email, reminder
               timers untouched. Idempotent — safe to re-run.

The status -> stage mapping for the 18 non-board statuses was supplied by
the admin on 2026-05-23. The script ABORTS if the CSV contains any status
it has no mapping for — it never guesses.

Usage
-----
    python import_status_update.py "<path-to.csv>" --dry-run   # report only, no writes
    python import_status_update.py "<path-to.csv>"             # apply
"""

from __future__ import annotations

import argparse
import csv
import sys
from collections import Counter

from db import get_app_conn, init_pools, put_app_conn


# The 7 board stages the portal supports. A Status already equal to one of
# these is kept unchanged (identity mapping).
VALID_STAGES = {
    "Unapproved",
    "Submitted",
    "Visit Scheduled",
    "Visit Completed",
    "Offer Given",
    "Price Rejected",
    "Duplicate Rejected",
}

# Granular CSV statuses -> board stage. Supplied by the admin on 2026-05-23.
# Every non-VALID_STAGES value in the CSV MUST appear here, or the script
# aborts before touching the database.
NEW_STATUS_MAP = {
    "OH Rejected":           "Duplicate Rejected",
    "Negotiation":           "Offer Given",
    "Price High":            "Price Rejected",
    "Hold":                  "Duplicate Rejected",
    "Seller Rejected":       "Duplicate Rejected",
    "Dead - Sold":           "Duplicate Rejected",
    "Followup":              "Offer Given",
    "Future Prospect":       "Duplicate Rejected",
    "New":                   "Submitted",
    "Dead - Not Interested": "Duplicate Rejected",
    "Duplicacy":             "Duplicate Rejected",
    "Key Handover":          "Offer Given",
    "Token Transferred":     "Offer Given",
    "Listed":                "Offer Given",
    "Dead - Legal":          "Duplicate Rejected",
    "AMA Signed":            "Offer Given",
    "AMA Req":               "Offer Given",
    "Cancelled Post Token":  "Offer Given",
}


def project(real_status: str) -> str:
    """Return the board stage a CSV Status value projects onto."""
    if real_status in VALID_STAGES:
        return real_status
    return NEW_STATUS_MAP[real_status]


def read_csv(path: str) -> list[tuple[int, str]]:
    """Parse the CSV into [(internal_id, status), ...]. Aborts on bad data."""
    rows: list[tuple[int, str]] = []
    seen: dict[int, int] = {}
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        missing = {"Internal ID", "Status"} - set(reader.fieldnames or [])
        if missing:
            sys.exit(f"ABORT: CSV missing required column(s): {sorted(missing)}")
        for lineno, row in enumerate(reader, start=2):  # line 1 = header
            raw_id = (row.get("Internal ID") or "").strip()
            status = (row.get("Status") or "").strip()
            if not raw_id or not raw_id.isdigit():
                sys.exit(f"ABORT: line {lineno}: bad/blank Internal ID {raw_id!r}")
            if not status:
                sys.exit(f"ABORT: line {lineno}: blank Status")
            iid = int(raw_id)
            if iid in seen:
                sys.exit(
                    f"ABORT: Internal ID {iid} appears twice "
                    f"(lines {seen[iid]} and {lineno})"
                )
            seen[iid] = lineno
            rows.append((iid, status))
    if not rows:
        sys.exit("ABORT: CSV has no data rows")
    return rows


def validate_mapping(rows: list[tuple[int, str]]) -> None:
    """Abort if any CSV status has neither an identity nor an explicit mapping."""
    unknown = sorted(
        {s for _, s in rows if s not in VALID_STAGES and s not in NEW_STATUS_MAP}
    )
    if unknown:
        print("ABORT: the CSV contains status values with no mapping:")
        for u in unknown:
            print(f"   - {u!r}")
        print("Add them to NEW_STATUS_MAP before running.")
        sys.exit(1)


def run(conn, rows: list[tuple[int, str]], dry_run: bool) -> None:
    ids = [iid for iid, _ in rows]
    real_by_id = {iid: status for iid, status in rows}

    with conn.cursor() as cur:
        cur.execute("""
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'submissions' AND column_name = 'real_status'
        """)
        has_col = cur.fetchone() is not None

        extra = ", real_status" if has_col else ""
        cur.execute(
            f"SELECT id, status, deleted_at, withdraw_reason{extra} "
            f"FROM submissions WHERE id = ANY(%s)",
            (ids,),
        )
        db_rows = {r["id"]: r for r in cur.fetchall()}

    found = [iid for iid in ids if iid in db_rows]
    missing = [iid for iid in ids if iid not in db_rows]

    status_changes: Counter = Counter()   # (old_stage -> new_stage)
    status_same = 0
    deleted_hits: list[tuple[int, str]] = []
    plan: list[tuple[int, str, str, str]] = []  # (id, old_status, new_status, real)

    for iid in found:
        db = db_rows[iid]
        real = real_by_id[iid]
        new_status = project(real)
        old_status = db["status"]
        if db.get("deleted_at") is not None:
            deleted_hits.append((iid, db.get("withdraw_reason")))
        if old_status != new_status:
            status_changes[(old_status, new_status)] += 1
        else:
            status_same += 1
        plan.append((iid, old_status, new_status, real))

    # ---------------- report ----------------
    print()
    print("=" * 70)
    mode = "DRY RUN — no changes written" if dry_run else "APPLYING CHANGES"
    print(f"  STATUS CLEAN-UP  ·  {mode}")
    print("=" * 70)
    print(f"  CSV rows ........................ {len(rows)}")
    print(f"  Matched in DB ................... {len(found)}")
    print(f"  NOT found in DB ................. {len(missing)}")
    if missing:
        print(f"      missing Internal IDs: {missing}")
    print(f"  Soft-deleted among matched ...... {len(deleted_hits)}")
    for iid, wr in deleted_hits:
        print(f"      id={iid}  withdraw_reason={wr!r}  (status still updated)")

    print()
    print(f"  submissions.status  — will change ... {sum(status_changes.values())}")
    print(f"  submissions.status  — already OK ... {status_same}")
    if status_changes:
        print("  Stage transitions (current -> new):")
        for (old, new), n in sorted(status_changes.items(), key=lambda x: -x[1]):
            print(f"      {n:5d}   {(old or '(none)'):<22} ->  {new}")

    print()
    print(f"  submissions.real_status — set on .... {len(found)} matched rows")
    print("  real_status  ->  board stage  (× rows):")
    rs: Counter = Counter((real, new) for (_, _, new, real) in plan)
    for (real, new), n in sorted(rs.items(), key=lambda x: -x[1]):
        tag = "" if real in VALID_STAGES else "   [mapped]"
        print(f"      {n:5d}   {real:<24} ->  {new}{tag}")

    if dry_run:
        print()
        print("  DRY RUN complete — database untouched.")
        print("  Re-run without --dry-run to apply.")
        print("=" * 70)
        return

    # ---------------- apply ----------------
    to_update: list[tuple[str, str, int]] = []  # (new_status, real, id)
    for iid, old_status, new_status, real in plan:
        cur_real = db_rows[iid].get("real_status") if has_col else None
        if old_status == new_status and cur_real == real:
            continue  # already correct — skip (idempotent re-run)
        to_update.append((new_status, real, iid))

    with conn.cursor() as cur:
        # Additive, instant, idempotent — safe even if the migration already ran.
        cur.execute(
            "ALTER TABLE submissions ADD COLUMN IF NOT EXISTS real_status VARCHAR(40)"
        )
        cur.executemany(
            "UPDATE submissions SET status = %s, real_status = %s WHERE id = %s",
            to_update,
        )
    conn.commit()

    print()
    print(f"  APPLIED — {len(to_update)} row(s) updated and committed.")
    print(f"  ({len(found) - len(to_update)} already correct, skipped.)")
    print("=" * 70)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("csv_path", help="path to the edited submissions CSV")
    ap.add_argument(
        "--dry-run", action="store_true",
        help="report what would change; write nothing",
    )
    args = ap.parse_args()

    rows = read_csv(args.csv_path)
    validate_mapping(rows)

    init_pools()
    conn = get_app_conn()
    try:
        run(conn, rows, dry_run=args.dry_run)
    finally:
        put_app_conn(conn)


if __name__ == "__main__":
    main()
