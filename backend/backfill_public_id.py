"""One-time backfill: assign a public_id to submissions that have none.

~1142 historical rows (imported before public_id existed) have public_id IS NULL.
This walks them oldest-first and hands each the next id for its city.

Numbering is identical to the production generator (public_id.generate_public_id):
same prefix (build_full_prefix), same "continue from MAX(number) for this
prefix", same 4-digit zero-pad. We reuse build_full_prefix + _extract_number so
the two can't drift. The only difference is mechanical — the generator does one
SELECT-FOR-UPDATE per insert (right for live, concurrent inserts); here there
are no concurrent inserts to serialize against (we hold the whole set FOR
UPDATE), so the per-city counter is advanced in memory and written in ONE batch.
1142 round-trips took >2min; this is a couple of queries total.

Safety:
  - all in one transaction; the partial UNIQUE index (uq_sub_public_id) aborts
    the run if any assignment would collide, so a duplicate can never commit.
  - DRY RUN by default (prints the plan, rolls back). Pass --commit to write.

forms_uid note: a couple of these rows carry a forms_uid like 'OHNC1248' — the
external Forms/visit app's OWN id namespace (OHNC…), NOT a submissions public_id
(OHLNC…). It doesn't substitute for one, so those rows get a normal public_id
and are simply listed in the report.

Usage:
    python backfill_public_id.py            # dry run
    python backfill_public_id.py --commit   # write
"""

import sys

from psycopg2.extras import execute_values

from config import Config
from db import get_app_conn, put_app_conn, init_pools
from public_id import build_full_prefix, city_to_prefix, _extract_number


def _current_max_number(cur, prefix: str) -> int:
    """Highest existing number for a prefix — same lookup generate_public_id
    uses, so the backfill continues the live sequence exactly.

    FOR UPDATE, like the generator: it locks the top row for the prefix, so a
    concurrent live insert (which takes the same lock) blocks until this
    transaction ends instead of racing us for the next number. The UNIQUE index
    is still the ultimate backstop, but this avoids losing the race in the first
    place."""
    cur.execute(
        """
        SELECT public_id FROM submissions
        WHERE public_id LIKE %s
        ORDER BY public_id DESC LIMIT 1
        FOR UPDATE
        """,
        (f"{prefix}%",),
    )
    row = cur.fetchone()
    return _extract_number(row["public_id"]) if row else 0


def main(commit: bool) -> int:
    Config.validate()
    init_pools()

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            # Oldest first, id as the tie-break (submitted_at is date-only on
            # these old rows). FOR UPDATE locks the set so a concurrent insert
            # can't grab a public_id we're about to hand out.
            cur.execute("""
                SELECT id, city, forms_uid
                FROM submissions
                WHERE public_id IS NULL OR TRIM(public_id) = ''
                ORDER BY submitted_at ASC, id ASC
                FOR UPDATE
            """)
            rows = cur.fetchall()

            total = len(rows)
            print(f"{'COMMIT' if commit else 'DRY RUN'}: {total} row(s) missing public_id\n", flush=True)
            if not total:
                conn.rollback()
                return 0

            # Seed each city's counter from its current MAX, once.
            counters = {}       # prefix -> next number to assign
            updates = []        # (id, new_public_id) for the batch write
            skipped = []        # unmappable city — left NULL, reported
            with_forms_uid = [] # (id, new_pid, forms_uid, city) — reported

            for r in rows:
                city = r["city"]
                prefix = build_full_prefix(city)
                if prefix is None:
                    skipped.append(r)
                    continue
                if prefix not in counters:
                    counters[prefix] = _current_max_number(cur, prefix) + 1

                new_pid = f"{prefix}{counters[prefix]:04d}"
                counters[prefix] += 1
                updates.append((r["id"], new_pid))
                if r["forms_uid"]:
                    with_forms_uid.append((r["id"], new_pid, r["forms_uid"], city))

            # Batch write: one statement, joined on a VALUES list.
            execute_values(
                cur,
                """
                UPDATE submissions AS s SET public_id = v.pid
                FROM (VALUES %s) AS v(id, pid)
                WHERE s.id = v.id
                """,
                updates,
                template="(%s, %s)",
            )

            # Per-city summary + a sample so the plan is reviewable in a dry run.
            print("per city (first/last assigned):")
            by_prefix = {}
            for _id, pid in updates:
                pre = pid[:-4]
                by_prefix.setdefault(pre, []).append(pid)
            for pre, pids in sorted(by_prefix.items()):
                print(f"  {pre:<8} {len(pids):>5} rows   {pids[0]} … {pids[-1]}")
            print(f"\nassigned: {len(updates)}   skipped (unmappable city): {len(skipped)}")

            if with_forms_uid:
                print(f"\nrows that ALSO had a forms_uid ({len(with_forms_uid)}):")
                print(f"  {'id':<7}{'new public_id':<15}{'forms_uid':<12}{'city'}")
                for sid, pid, fuid, city in with_forms_uid:
                    print(f"  {sid:<7}{pid:<15}{fuid:<12}{city}")

            if skipped:
                print("\nSKIPPED — no prefix for city (left NULL):")
                for r in skipped:
                    print(f"  id={r['id']} city={r['city']!r}")

            if commit:
                conn.commit()
                print("\nCOMMITTED.", flush=True)
            else:
                conn.rollback()
                print("\nDRY RUN — rolled back, nothing written. Re-run with --commit to apply.", flush=True)
        return 0
    except Exception:
        conn.rollback()
        raise
    finally:
        put_app_conn(conn)


if __name__ == "__main__":
    sys.exit(main(commit="--commit" in sys.argv[1:]))
