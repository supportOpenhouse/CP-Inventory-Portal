"""Fuzzy-match unmatched active submissions to properties by society+tower+unit.

Target: submissions with status in the 4 active stages AND forms_uid IS NULL.
Reuses the portal's own matcher (duplicate_check.check_duplicate) so the fuzzy
society / tower / unit logic is IDENTICAL to what the app uses to link a lead to
a property. Only the properties-side matches are reported (not other CP subs).

Output columns:
  public_id (cp_lead_uid) | cp_status | forms_uid_match  (forms stage in ())

A match kind other than exact is flagged, e.g. OHNC1417 (Listing) [fuzzy], so
weak/partial matches are visible rather than silently mixed with perfect hits.

Run:  cd backend && ./venv/bin/python match_by_unit_report.py
"""

import logging

from config import Config
from db import init_pools, get_app_conn, put_app_conn, get_props_conn, put_props_conn
from duplicate_check import check_duplicate

logging.basicConfig(level=logging.WARNING)  # silence per-query INFO chatter
ACTIVE = ('Visit Completed', 'Closure', 'Offer', 'Visit Scheduled')


def main():
    Config.validate()
    init_pools()

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, public_id, status, cp_id,
                       society, city, bhk, tower, unit_no, floor, sqft
                FROM submissions
                WHERE status = ANY(%s) AND forms_uid IS NULL
                ORDER BY id
                """,
                (list(ACTIVE),),
            )
            subs = cur.fetchall()
    finally:
        put_app_conn(conn)

    print(f"{'public_id (cp_lead_uid)':<26}{'cp_status':<18}forms_uid_match (forms stage)", flush=True)
    print("-" * 90, flush=True)

    matched = 0
    for i, s in enumerate(subs, 1):
        try:
            dup = check_duplicate(
                society=s["society"], city=s["city"], bhk=s["bhk"],
                tower=s["tower"], unit_no=s["unit_no"], floor=s["floor"],
                sqft=s["sqft"], cp_id=s["cp_id"], exclude_submission_id=s["id"],
            )
        except Exception as e:  # noqa: BLE001 - best-effort per row, like the backfill
            print(f"  [skip] {s['public_id']}: {e}", flush=True)
            continue

        prop_matches = [
            (m["id"], m["match"])
            for m in dup["match_details"]
            if m["source"] == "properties" and m["id"]
        ]
        if not prop_matches:
            continue

        # Narrow to candidates worth reporting: CP-source properties that were
        # NEVER linked back to a submission — i.e. lead_id is not a real
        # public_id (all valid public_ids start with 'OHL'). Also grab stage.
        uids = [uid for uid, _ in prop_matches]
        pconn = get_props_conn()
        try:
            with pconn.cursor() as cur:
                cur.execute(
                    """
                    SELECT uid, stage FROM properties
                    WHERE uid = ANY(%s)
                      AND source = 'CP'
                      AND (lead_id IS NULL OR lead_id NOT LIKE 'OHL%%')
                    """,
                    (uids,),
                )
                keep = {r["uid"]: r["stage"] for r in cur.fetchall()}
        finally:
            put_props_conn(pconn)

        prop_matches = [(uid, kind) for uid, kind in prop_matches if uid in keep]
        if not prop_matches:
            continue
        matched += 1

        cell = ", ".join(
            f"{uid} ({keep.get(uid) or '—'})" + ("" if kind == "exact" else f" [{kind}]")
            for uid, kind in prop_matches
        )
        print(f"{(s['public_id'] or '—'):<26}{s['status']:<18}{cell}", flush=True)

    print(f"\n{matched}/{len(subs)} unmatched active submissions matched a property.", flush=True)


if __name__ == '__main__':
    main()
