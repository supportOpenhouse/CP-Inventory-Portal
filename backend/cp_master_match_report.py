"""Match Properties-DB `cp_master` rows to App-DB `channel_partners`.

READ-ONLY. Produces a match report; writes nothing. Run the companion
apply step only once you're happy with what this prints.

Matching, in the order asked for:
  1. phone   — normalised to the last 10 digits (utils.normalize_phone)
  2. name    — exact, after case/punctuation normalisation
  3. name    — fuzzy, SequenceMatcher ratio >= 0.80

Anything a tier resolves to more than one channel_partner is reported
AMBIGUOUS and left unmatched rather than guessed at: these rows carry KYC
document URLs, and attaching someone's Aadhaar to the wrong CP is worse
than leaving it unattached.

Cross-DB rule (CLAUDE.md): no SQL join across databases. Both sides are
pulled separately and merged here in Python.

    cd backend && ./venv/bin/python cp_master_match_report.py
"""

import csv
import os
import re
import sys
from difflib import SequenceMatcher

import psycopg2
import psycopg2.extras

from config import Config
from utils import normalize_phone

FUZZY_MIN = 0.80
OUT_CSV = os.environ.get("OUT_CSV", "cp_master_match_report.csv")

# cp_master column -> channel_partners column. The names differ on PAN.
DOC_COLUMNS = {
    "cp_aadhaar_front_url": "cp_aadhaar_front_url",
    "cp_aadhaar_back_url": "cp_aadhaar_back_url",
    "cp_pan_card_url": "cp_pan_url",
    "cp_cancelled_cheque_url": "cp_cancelled_cheque_url",
}


def norm_name(v):
    """Lowercase, drop punctuation, collapse whitespace. Keeps 'M/s Sharma &
    Co.' and 'ms sharma and co' apart from being a coin flip on punctuation."""
    if not v:
        return ""
    s = re.sub(r"[^a-z0-9\s]", " ", str(v).lower())
    return re.sub(r"\s+", " ", s).strip()


def fetch(url, sql):
    conn = psycopg2.connect(url)
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql)
            return cur.fetchall()
    finally:
        conn.close()


def build_matches():
    """Run the match and return (rows, counts). Shared with the apply step so
    the two can never disagree about what 'MATCHED' means."""
    if not Config.PROPERTIES_DATABASE_URL:
        sys.exit("PROPERTIES_DATABASE_URL is not set")

    masters = fetch(Config.PROPERTIES_DATABASE_URL, """
        SELECT id, cp_code, cp_name, cp_phone, cp_firm, cp_email,
               cp_aadhaar_front_url, cp_aadhaar_back_url,
               cp_pan_card_url, cp_cancelled_cheque_url
        FROM cp_master ORDER BY id
    """)
    partners = fetch(Config.DATABASE_URL, """
        SELECT id, cp_code, name, phone, city, is_active
        FROM channel_partners ORDER BY id
    """)
    print(f"cp_master: {len(masters)} rows   channel_partners: {len(partners)} rows\n")

    # Indexes. Values are LISTS: duplicate phones and duplicate names both
    # exist in a 6958-row table, and collapsing them to one silently picks a
    # winner — exactly the guess this script refuses to make.
    by_phone, by_name = {}, {}
    for p in partners:
        ph = normalize_phone(p["phone"])
        if ph:
            by_phone.setdefault(ph, []).append(p)
        nm = norm_name(p["name"])
        if nm:
            by_name.setdefault(nm, []).append(p)

    # Pre-normalised list for the fuzzy pass, so norm_name isn't recomputed
    # 123 times per partner.
    fuzzy_pool = [(norm_name(p["name"]), p) for p in partners if p["name"]]

    rows, counts = [], {}
    for m in masters:
        method, cands = "none", []

        ph = normalize_phone(m["cp_phone"])
        if ph and ph in by_phone:
            method, cands = "phone", by_phone[ph]

        if not cands:
            nm = norm_name(m["cp_name"])
            if nm and nm in by_name:
                method, cands = "name_exact", by_name[nm]

        best_score = ""
        if not cands:
            nm = norm_name(m["cp_name"])
            if nm:
                scored = []
                for pn, p in fuzzy_pool:
                    # real_quick_ratio/quick_ratio are cheap upper bounds —
                    # bail before the real O(n*m) diff when they can't clear
                    # the threshold. Keeps 123 x 6958 comparisons snappy.
                    sm = SequenceMatcher(None, nm, pn)
                    if sm.real_quick_ratio() < FUZZY_MIN or sm.quick_ratio() < FUZZY_MIN:
                        continue
                    r = sm.ratio()
                    if r >= FUZZY_MIN:
                        scored.append((r, p))
                if scored:
                    top = max(s[0] for s in scored)
                    # Only ties at the top are ambiguous; a clear winner over
                    # weaker candidates is still a match.
                    cands = [p for r, p in scored if r >= top - 1e-9]
                    method, best_score = "name_fuzzy", f"{top:.3f}"

        if not cands:
            status, chosen = "UNMATCHED", None
        elif len(cands) > 1:
            status, chosen = "AMBIGUOUS", None
        else:
            status, chosen = "MATCHED", cands[0]

        key = f"{status}/{method}" if status != "UNMATCHED" else "UNMATCHED"
        counts[key] = counts.get(key, 0) + 1

        docs = sum(1 for c in DOC_COLUMNS if m[c])
        rows.append({
            "status": status,
            "method": method,
            "score": best_score,
            "n_candidates": len(cands),
            "master_id": m["id"],
            "master_cp_code": m["cp_code"],
            "master_name": m["cp_name"],
            "master_phone": m["cp_phone"],
            "master_firm": m["cp_firm"],
            "docs_available": docs,
            "cp_id": chosen["id"] if chosen else "",
            "our_cp_code": chosen["cp_code"] if chosen else "",
            "our_name": chosen["name"] if chosen else "",
            "our_phone": chosen["phone"] if chosen else "",
            "our_city": chosen["city"] if chosen else "",
            "our_is_active": chosen["is_active"] if chosen else "",
            # Independent sanity signal: both tables carry a cp_code, so when
            # they agree the match is corroborated by something the matcher
            # never looked at. Disagreement is worth eyeballing before applying.
            # How close the two NAMES are on a match found by phone. With
            # cp_code useless as corroboration (the two tables number their CPs
            # independently), this is the only independent check left on a
            # phone hit — a shared phone with wildly different names is either
            # a recycled number or a data-entry error, and these rows carry KYC
            # documents, so those need eyes before anything is written.
            "name_sim": ("" if not chosen else
                         f"{SequenceMatcher(None, norm_name(m['cp_name']), norm_name(chosen['name'])).ratio():.2f}"),
            "cp_code_agrees": ("" if not chosen else
                               "yes" if (chosen["cp_code"] or "").strip().upper()
                               == (m["cp_code"] or "").strip().upper() else "NO"),
            "candidate_ids": "|".join(str(c["id"]) for c in cands) if len(cands) > 1 else "",
        })

    return rows, counts


def main():
    rows, counts = build_matches()

    with open(OUT_CSV, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    matched = [r for r in rows if r["status"] == "MATCHED"]
    print("BY OUTCOME")
    for k in sorted(counts):
        print(f"  {k:<24} {counts[k]:>4}")
    print(f"\n  {'TOTAL':<24} {len(rows):>4}")

    agree = sum(1 for r in matched if r["cp_code_agrees"] == "yes")
    print(f"\ncp_code corroboration: {agree}/{len(matched)} agree")
    if matched and agree == 0:
        print("  -> ZERO agreement: the two tables number their CPs independently")
        print("     (cp_master 'CP0002' vs channel_partners 'CP00311'). cp_code is")
        print("     therefore useless BOTH as a join key and as a cross-check.")

    print(f"\nPHONE MATCHES WITH DIVERGENT NAMES (similarity < 0.60 — review these)")
    weak = sorted((r for r in matched if r["method"] == "phone" and r["name_sim"]
                   and float(r["name_sim"]) < 0.60), key=lambda r: float(r["name_sim"]))
    for r in weak:
        print(f"  sim {r['name_sim']}  {r['master_name'][:30]:<30} -> cp #{r['cp_id']:<6} "
              f"{r['our_name'][:30]:<30} phone {r['master_phone']}")
    if not weak:
        print("  (none)")

    print("\nFUZZY MATCHES (eyeball these — they are the ones that can be wrong)")
    fz = [r for r in matched if r["method"] == "name_fuzzy"]
    for r in fz:
        print(f"  {r['score']}  {r['master_name'][:34]:<34} -> {r['our_name'][:34]:<34} "
              f"code {r['master_cp_code']} vs {r['our_cp_code']}")
    if not fz:
        print("  (none)")

    print("\nCOLLISIONS (several cp_master rows resolving to ONE channel_partner)")
    # Matters for the apply step, not this one: writing them in sequence would
    # leave whichever row ran last, silently. Must be resolved by hand first.
    seen = {}
    for r in matched:
        seen.setdefault(r["cp_id"], []).append(r)
    collisions = {k: v for k, v in seen.items() if len(v) > 1}
    for cp_id, group in collisions.items():
        print(f"  cp #{cp_id} ({group[0]['our_name'][:28]}) <- " +
              ", ".join(f"{g['master_cp_code']}/{g['master_name'][:20]}" for g in group))
    if not collisions:
        print("  (none)")
    print(f"  distinct channel_partners targeted: {len(seen)} from {len(matched)} matched rows")

    print("\nAMBIGUOUS (left unmatched — pick one by hand, or match on cp_code)")
    for r in (r for r in rows if r["status"] == "AMBIGUOUS"):
        print(f"  {r['master_cp_code']:<12} {r['master_name'][:30]:<30} {r['method']:<10} -> cp ids {r['candidate_ids']}")

    print("\nUNMATCHED")
    for r in (r for r in rows if r["status"] == "UNMATCHED"):
        print(f"  {r['master_cp_code']:<12} {r['master_name'][:30]:<30} phone={r['master_phone']}")

    movable = sum(r["docs_available"] for r in matched)
    print(f"\nDocument URLs that a matched row would carry over: {movable}")
    print(f"CSV written: {OUT_CSV}")


if __name__ == "__main__":
    main()
