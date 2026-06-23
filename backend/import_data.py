"""
Openhouse CP Inventory Portal — one-shot data import.

Loads:
  - CP database CSV  -> channel_partners table
  - Societies CSV    -> societies table

Safe to re-run: upserts on CSV id (channel_partners) and (name, city_id) (societies).
Drops CPs with phone numbers that aren't exactly 10 digits and logs them to
a drop report.

Usage (from the backend/ folder):
    # 1. Activate your virtualenv
    # 2. Make sure DATABASE_URL is set in .env
    # 3. Run:
    python import_data.py --cps ../../data/cp_database.csv --societies ../../data/master_societies.csv
"""

import argparse
import csv
import json
import os
import re
import sys
from pathlib import Path

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv


# ------------------------------------------------------------
# Config
# ------------------------------------------------------------

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    print("ERROR: DATABASE_URL not found in .env. Aborting.")
    sys.exit(1)

DROP_REPORT_PATH = Path(__file__).parent / "import_drop_report.csv"

CITY_NORMALIZATION = {
    # CSV value (lowercased) -> canonical city name in our DB
    "noida": "Noida",
    "greater noida": "Noida",          # per spec: Greater Noida rolls into Noida
    "ghaziabad": "Ghaziabad",
    "gurgaon": "Gurgaon",
    "gurugram": "Gurgaon",
}


# ------------------------------------------------------------
# Helpers
# ------------------------------------------------------------

def normalize_phone(raw: str) -> str | None:
    """Strip non-digits, take last 10 digits. Return None if not valid."""
    if not raw:
        return None
    digits = re.sub(r"\D", "", raw)
    if len(digits) < 10:
        return None              # too short, drop
    return digits[-10:]          # handle "+91...", "91...", spaces, etc.


def normalize_city(raw: str) -> str | None:
    if not raw:
        return None
    return CITY_NORMALIZATION.get(raw.strip().lower())


def parse_micromarkets(raw: str) -> list[str]:
    """CSV stores micromarkets as comma-separated: 'Central Noida, Noida Extension'."""
    if not raw:
        return []
    return [m.strip() for m in raw.split(",") if m.strip()]


# ------------------------------------------------------------
# City lookup
# ------------------------------------------------------------

def load_city_map(cur) -> dict[str, int]:
    cur.execute("SELECT id, name FROM cities")
    return {row["name"]: row["id"] for row in cur.fetchall()}


# ------------------------------------------------------------
# CP import
# ------------------------------------------------------------

def import_cps(conn, cp_csv_path: Path, city_map: dict[str, int]) -> dict:
    stats = {"total": 0, "inserted": 0, "updated": 0, "dropped": 0}
    drops = []

    with cp_csv_path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    stats["total"] = len(rows)
    print(f"[CPs] Read {len(rows)} rows from {cp_csv_path.name}")

    cur = conn.cursor()

    for row in rows:
        phone = normalize_phone(row.get("phone_number", ""))
        city_name = normalize_city(row.get("city", ""))
        cp_code = (row.get("cp_code") or "").strip()
        name = (row.get("name") or "").strip()

        reason = None
        if not phone:
            reason = "phone < 10 digits or empty"
        elif not cp_code:
            reason = "missing cp_code"
        elif not name:
            reason = "missing name"
        elif not city_name:
            reason = f"unknown city: {row.get('city', '')!r}"

        if reason:
            stats["dropped"] += 1
            drops.append({**row, "drop_reason": reason})
            continue

        micromarkets = parse_micromarkets(row.get("micro_markets", ""))
        company = (row.get("company_name") or "").strip() or None
        city_id = city_map[city_name]

        # Upsert on cp_code
        cur.execute(
            """
            INSERT INTO channel_partners
                (cp_code, name, phone, company, city_id, micro_markets, is_admin, is_active)
            VALUES (%s, %s, %s, %s, %s, %s::jsonb, FALSE, TRUE)
            ON CONFLICT (cp_code) DO UPDATE SET
                name          = EXCLUDED.name,
                phone         = EXCLUDED.phone,
                company       = EXCLUDED.company,
                city_id       = EXCLUDED.city_id,
                micro_markets = EXCLUDED.micro_markets
            RETURNING (xmax = 0) AS was_insert
            """,
            (cp_code, name, phone, company, city_id, json.dumps(micromarkets)),
        )
        was_insert = cur.fetchone()["was_insert"]
        if was_insert:
            stats["inserted"] += 1
        else:
            stats["updated"] += 1

    conn.commit()
    cur.close()

    # Write drop report
    if drops:
        with DROP_REPORT_PATH.open("w", encoding="utf-8", newline="") as f:
            # Use first drop's keys (they all share headers + drop_reason)
            fieldnames = list(drops[0].keys())
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(drops)

    return stats


# ------------------------------------------------------------
# Society import
# ------------------------------------------------------------

def import_societies(conn, soc_csv_path: Path, city_map: dict[str, int]) -> dict:
    stats = {"total": 0, "inserted": 0, "updated": 0, "dropped": 0}

    with soc_csv_path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    stats["total"] = len(rows)
    print(f"[Societies] Read {len(rows)} rows from {soc_csv_path.name}")

    cur = conn.cursor()

    for row in rows:
        name = (row.get("society_name") or "").strip()
        city_name = normalize_city(row.get("city", ""))
        locality = (row.get("locality") or "").strip() or None

        if not name or not city_name:
            stats["dropped"] += 1
            continue

        city_id = city_map[city_name]

        # Upsert on (name, city_id)
        cur.execute(
            """
            INSERT INTO societies (name, city_id, locality)
            VALUES (%s, %s, %s)
            ON CONFLICT (name, city_id) DO UPDATE SET
                locality = EXCLUDED.locality
            RETURNING (xmax = 0) AS was_insert
            """,
            (name, city_id, locality),
        )
        was_insert = cur.fetchone()["was_insert"]
        if was_insert:
            stats["inserted"] += 1
        else:
            stats["updated"] += 1

    conn.commit()
    cur.close()
    return stats


# ------------------------------------------------------------
# Main
# ------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Import CPs and societies into Neon.")
    parser.add_argument("--cps", required=True, help="Path to CP database CSV")
    parser.add_argument("--societies", required=True, help="Path to master societies CSV")
    args = parser.parse_args()

    cp_path = Path(args.cps).resolve()
    soc_path = Path(args.societies).resolve()

    for p in (cp_path, soc_path):
        if not p.exists():
            print(f"ERROR: File not found: {p}")
            sys.exit(1)

    print(f"Connecting to Neon...")
    conn = psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
    print(f"Connected. Server time: {conn.cursor() and 'OK'}")

    # Load city name -> id map
    cur = conn.cursor()
    city_map = load_city_map(cur)
    cur.close()
    print(f"Loaded {len(city_map)} cities: {list(city_map.keys())}")

    print("\n--- Importing CPs ---")
    cp_stats = import_cps(conn, cp_path, city_map)

    print("\n--- Importing Societies ---")
    soc_stats = import_societies(conn, soc_path, city_map)

    conn.close()

    # Final report
    print("\n" + "=" * 50)
    print("IMPORT REPORT")
    print("=" * 50)
    print(f"Channel Partners:")
    print(f"  Read from CSV   : {cp_stats['total']}")
    print(f"  Inserted (new)  : {cp_stats['inserted']}")
    print(f"  Updated (exist) : {cp_stats['updated']}")
    print(f"  Dropped         : {cp_stats['dropped']}")
    if cp_stats['dropped']:
        print(f"  -> Drop report  : {DROP_REPORT_PATH}")

    print(f"\nSocieties:")
    print(f"  Read from CSV   : {soc_stats['total']}")
    print(f"  Inserted (new)  : {soc_stats['inserted']}")
    print(f"  Updated (exist) : {soc_stats['updated']}")
    print(f"  Dropped         : {soc_stats['dropped']}")

    print("\nDone.")


if __name__ == "__main__":
    main()