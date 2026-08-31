"""Copy KYC document URLs from Properties-DB `cp_master` onto App-DB
`channel_partners`, for every row the report resolves to status MATCHED.

    cd backend && ./venv/bin/python cp_master_apply_docs.py            # dry run
    cd backend && ./venv/bin/python cp_master_apply_docs.py --apply    # writes

Matching is imported from cp_master_match_report so the two can never disagree
about what MATCHED means. Run the report first and read its warnings.

COLLISIONS: 117 matched rows land on only 99 distinct channel_partners, so some
CPs are targeted by several cp_master rows. Plain sequential UPDATEs would
leave whichever ran last, silently and unpredictably. Instead every write is
    SET col = COALESCE(col, %s)
processed in cp_master.id order. That makes it fill-only:
  - a column already holding a value is never overwritten (by a second
    cp_master row, or by anything that lands there in future),
  - a later row can still contribute a document an earlier row lacked,
  - the result does not depend on row ordering surviving a re-run.
"""

import sys

import psycopg2

from config import Config
from cp_master_match_report import DOC_COLUMNS, build_matches

APPLY = "--apply" in sys.argv


def main():
    rows, _ = build_matches()
    matched = [r for r in rows if r["status"] == "MATCHED"]

    # build_matches only reports the doc COUNT, so re-read the URLs themselves
    # keyed by cp_master.id.
    props = psycopg2.connect(Config.PROPERTIES_DATABASE_URL)
    try:
        with props.cursor() as cur:
            cur.execute(
                "SELECT id, %s FROM cp_master" % ", ".join(DOC_COLUMNS),
            )
            docs = {r[0]: dict(zip(DOC_COLUMNS, r[1:])) for r in cur.fetchall()}
    finally:
        props.close()

    targets = sorted({r["cp_id"] for r in matched})
    print(f"MATCHED rows: {len(matched)}   distinct channel_partners: {len(targets)}")
    print(f"mode: {'APPLY (writing)' if APPLY else 'DRY RUN (no writes)'}\n")

    app = psycopg2.connect(Config.DATABASE_URL)
    app.autocommit = False
    try:
        with app.cursor() as cur:
            # Snapshot before, so the summary is measured rather than assumed.
            cur.execute(
                "SELECT count(*) FROM channel_partners WHERE id = ANY(%s) AND "
                + " OR ".join(f"{c} IS NOT NULL" for c in DOC_COLUMNS.values()).join(("(", ")")),
                (targets,),
            )
            before = cur.fetchone()[0]

            writes = 0
            skipped_empty = 0
            for r in sorted(matched, key=lambda r: r["master_id"]):
                d = docs.get(r["master_id"], {})
                vals = {DOC_COLUMNS[k]: (v or None) for k, v in d.items()}
                if not any(vals.values()):
                    skipped_empty += 1
                    continue
                sets = ", ".join(f"{c} = COALESCE({c}, %s)" for c in vals)
                cur.execute(
                    f"UPDATE channel_partners SET {sets} WHERE id = %s",
                    (*vals.values(), r["cp_id"]),
                )
                writes += cur.rowcount

            cur.execute(
                "SELECT "
                + ", ".join(f"count({c}) AS {c}" for c in DOC_COLUMNS.values())
                + " FROM channel_partners WHERE id = ANY(%s)",
                (targets,),
            )
            filled = cur.fetchone()
            cur.execute(
                "SELECT count(*) FROM channel_partners WHERE id = ANY(%s) AND "
                + " OR ".join(f"{c} IS NOT NULL" for c in DOC_COLUMNS.values()).join(("(", ")")),
                (targets,),
            )
            after = cur.fetchone()[0]

            print(f"UPDATE statements affecting a row : {writes}")
            print(f"cp_master rows with no documents  : {skipped_empty}")
            print(f"CPs holding >=1 document  before  : {before}")
            print(f"CPs holding >=1 document  after   : {after}")
            print("\nper-column fill across the targeted CPs:")
            for col, n in zip(DOC_COLUMNS.values(), filled):
                print(f"  {col:<26} {n:>4}")

            if APPLY:
                app.commit()
                print("\nCOMMITTED")
            else:
                app.rollback()
                print("\nROLLED BACK — re-run with --apply to keep these changes")
    except Exception:
        app.rollback()
        raise
    finally:
        app.close()


if __name__ == "__main__":
    main()
