"""Unmatched active submissions -> candidate CP property uids, grouped by phone.

Target submissions: status in the 4 active stages AND forms_uid IS NULL.
For each seller_phone, find properties where:
  - source = 'CP'
  - contact_no matches the seller_phone (compared as last-10-digits)
  - lead_id is NOT a valid submissions.public_id  (i.e. the property was never
    linked back to a submission)
Report: phone, count of matching uids, and the uid array.

Run:  cd backend && ./venv/bin/python unmatched_phone_report.py
Env:  reads DATABASE_URL + PROPERTIES_DATABASE_URL from .env via Config.
"""

from config import Config
import psycopg2

ACTIVE = ('Visit Completed', 'Closure', 'Offer', 'Visit Scheduled')

# A lead_id is a "valid public_id" only if it looks like a real
# submissions.public_id. The actual public_ids in the DB are the *C* variants:
#   OHLNC…, OHLGC…, OHLGHC…   (there are NO OHLND/OHLGD/OHLGHD public_ids)
# Anything else (NULL, '99acres', uid-style 'OHNC1234', blanks, junk) is invalid.
# The request said OHLND/OHLGD/OHLGHD (D) — no such public_ids exist, so the
# real C-variant prefixes are used here. Edit VALID_PID_RE if you meant otherwise.
VALID_PID_RE = r'^OHL(NC|GC|GHC)[0-9]'


def main():
    Config.validate()

    # 1) submissions DB: distinct seller phones (last 10 digits) of the
    #    unmatched active submissions.
    app = psycopg2.connect(Config.DATABASE_URL)
    with app.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT right(regexp_replace(seller_phone, '\\D', '', 'g'), 10) AS phone10
            FROM submissions
            WHERE status = ANY(%s)
              AND forms_uid IS NULL
              AND seller_phone IS NOT NULL
              AND length(regexp_replace(seller_phone, '\\D', '', 'g')) >= 10
            """,
            (list(ACTIVE),),
        )
        phones = [r[0] for r in cur.fetchall()]
    app.close()

    if not phones:
        print("No unmatched active submissions have a usable seller_phone "
              "(all 120 target rows currently have seller_phone = NULL).")
        return

    # 2) properties DB: candidate CP properties per phone, invalid lead_id only.
    pr = psycopg2.connect(Config.PROPERTIES_DATABASE_URL)
    with pr.cursor() as cur:
        cur.execute(
            """
            SELECT right(regexp_replace(contact_no, '\\D', '', 'g'), 10) AS phone,
                   count(*)                                              AS uid_count,
                   array_agg(uid ORDER BY uid)                           AS uids
            FROM properties
            WHERE source = 'CP'
              AND right(regexp_replace(contact_no, '\\D', '', 'g'), 10) = ANY(%s)
              AND (lead_id IS NULL OR lead_id !~ %s)
            GROUP BY 1
            ORDER BY uid_count DESC, phone
            """,
            (phones, VALID_PID_RE),
        )
        rows = cur.fetchall()
    pr.close()

    print(f"{'phone':<14}{'count':<7}uids")
    print("-" * 60)
    for phone, cnt, uids in rows:
        print(f"{phone:<14}{cnt:<7}{uids}")
    print(f"\n{len(rows)} phone(s) with candidate CP properties.")


if __name__ == '__main__':
    main()
