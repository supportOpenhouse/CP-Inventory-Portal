"""One-off: apply the May-2026 CSV status clean-up to submissions.

Context
-------
The portal recognises 7 board stages (VALID_STAGES below). The admin
exported every listing via the "Export" button and hand-corrected the
Status column to each listing's REAL lifecycle stage. Many corrected
values are finer-grained than the board supports (OH Rejected,
Negotiation, Token Transferred, Hold, Followup, ...).

This script writes two columns per matched row:

    submissions.status         <- one of the 7 board stages
    submissions.status_reason  <- the granular sub-category when applicable
                                  (today only populated for status='Rejected')

Matching key : Internal ID  ==  submissions.id  (present on every CSV row).
Update style : SILENT — no submission_events, no WhatsApp/email, reminder
               timers untouched. Idempotent — safe to re-run.

The status -> (stage, reason) mapping for the 18 non-board statuses was
supplied by the admin on 2026-05-23 and revised on 2026-05-25 when the
'Duplicate Rejected' stage was renamed to 'Rejected' and status_reason was
introduced. The script ABORTS if the CSV contains any status it has no
mapping for — it never guesses.

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


# The 7 board stages the portal supports.
VALID_STAGES = {
    "Unapproved",
    "Submitted",
    "Visit Scheduled",
    "Visit Completed",
    "Offer",
    "Price Rejected",
    "Rejected",
}

# CSV Status -> (board stage, status_reason).
#
# Identity entries (CSV value already equals a board stage) keep
# status_reason=None. Granular CSV values either:
#   - project onto 'Rejected' with status_reason=verbatim (the 8 rejection
#     sub-reasons the admin maintains in the UI dropdown), or
#   - project onto another board stage with status_reason=None (per the
#     2026-05-25 decision to ignore non-rejection granular reasons for now).
#
# 'Future Prospect' is the one historical Duplicate-Rejected value that is
# NOT in the new 8-reason dropdown — we still send it to 'Rejected' but
# leave status_reason NULL for admin clean-up.
NEW_STATUS_MAP = {
    # Identity (board stages)
    "Unapproved":            ("Unapproved",      None),
    "Submitted":             ("Submitted",       None),
    "Visit Scheduled":       ("Visit Scheduled", None),
    "Visit Completed":       ("Visit Completed", None),
    "Offer Given":           ("Offer",           None),
    "Price Rejected":        ("Price Rejected",  None),
    "Rejected":              ("Rejected",        None),

    # Rejection sub-reasons -> 'Rejected' + status_reason
    "OH Rejected":           ("Rejected", "OH Rejected"),
    "Hold":                  ("Rejected", "Hold"),
    "Seller Rejected":       ("Rejected", "Seller Rejected"),
    "Dead - Sold":           ("Rejected", "Dead - Sold"),
    "Dead - Not Interested": ("Rejected", "Dead - Not Interested"),
    "Dead - Legal":          ("Rejected", "Dead - Legal"),
    "Duplicacy":             ("Rejected", "Duplicacy"),
    "Cancelled Post Token":  ("Rejected", "Cancelled Post Token"),

    # Historical reject value that lacks a dropdown counterpart — admin
    # will re-categorise later.
    "Future Prospect":       ("Rejected", None),

    # Non-rejection granular values: keep current projection, no reason.
    "Negotiation":           ("Offer",           None),
    "Followup":              ("Offer",           None),
    "Key Handover":          ("Offer",           None),
    "Token Transferred":     ("Offer",           None),
    "Listed":                ("Offer",           None),
    "AMA Signed":            ("Offer",           None),
    "AMA Req":               ("Offer",           None),
    "Price High":            ("Price Rejected",  None),
    "New":                   ("Submitted",       None),
}


def project(csv_status: str) -> tuple[str, str | None]:
    """Return (board stage, status_reason) for a CSV Status value."""
    return NEW_STATUS_MAP[csv_status]


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
    """Abort if any CSV status has no explicit mapping."""
    unknown = sorted({s for _, s in rows if s not in NEW_STATUS_MAP})
    if unknown:
        print("ABORT: the CSV contains status values with no mapping:")
        for u in unknown:
            print(f"   - {u!r}")
        print("Add them to NEW_STATUS_MAP before running.")
        sys.exit(1)


def run(conn, rows: list[tuple[int, str]], dry_run: bool) -> None:
    ids = [iid for iid, _ in rows]
    raw_by_id = {iid: status for iid, status in rows}

    with conn.cursor() as cur:
        cur.execute("""
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'submissions' AND column_name = 'status_reason'
        """)
        if cur.fetchone() is None:
            sys.exit(
                "ABORT: submissions.status_reason does not exist. Run "
                "migrations/2026-05-25-status-reason-and-rename-rejected.sql first."
            )

        cur.execute(
            "SELECT id, status, status_reason, deleted_at, withdraw_reason "
            "FROM submissions WHERE id = ANY(%s)",
            (ids,),
        )
        db_rows = {r["id"]: r for r in cur.fetchall()}

    found = [iid for iid in ids if iid in db_rows]
    missing = [iid for iid in ids if iid not in db_rows]

    status_changes: Counter = Counter()   # (old_stage, new_stage)
    status_same = 0
    deleted_hits: list[tuple[int, str]] = []
    plan: list[tuple[int, str, str | None, str, str | None, str]] = []
    # plan rows: (id, new_status, new_reason, old_status, old_reason, raw)

    for iid in found:
        db = db_rows[iid]
        raw = raw_by_id[iid]
        new_status, new_reason = project(raw)
        old_status = db["status"]
        old_reason = db.get("status_reason")
        if db.get("deleted_at") is not None:
            deleted_hits.append((iid, db.get("withdraw_reason")))
        if old_status != new_status:
            status_changes[(old_status, new_status)] += 1
        else:
            status_same += 1
        plan.append((iid, new_status, new_reason, old_status, old_reason, raw))

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
    print(f"  submissions.status_reason — written on .... {sum(1 for p in plan if p[2])} matched rows")
    print("  raw CSV value  ->  status (status_reason)  (× rows):")
    rs: Counter = Counter((raw, new_status, new_reason) for (_, new_status, new_reason, _, _, raw) in plan)
    for (raw, new_status, new_reason), n in sorted(rs.items(), key=lambda x: -x[1]):
        reason_str = f" / reason={new_reason}" if new_reason else ""
        print(f"      {n:5d}   {raw:<24} ->  {new_status}{reason_str}")

    if dry_run:
        print()
        print("  DRY RUN complete — database untouched.")
        print("  Re-run without --dry-run to apply.")
        print("=" * 70)
        return

    # ---------------- apply ----------------
    to_update: list[tuple[str, str | None, int]] = []  # (new_status, new_reason, id)
    for iid, new_status, new_reason, old_status, old_reason, _ in plan:
        if old_status == new_status and old_reason == new_reason:
            continue  # already correct — skip (idempotent re-run)
        to_update.append((new_status, new_reason, iid))

    with conn.cursor() as cur:
        cur.executemany(
            "UPDATE submissions SET status = %s, status_reason = %s WHERE id = %s",
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
