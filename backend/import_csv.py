"""Import cleaned CP inventory CSV into the submissions table.

Usage:
    python import_csv.py path/to/legacy.csv                   # Noida only (default)
    python import_csv.py path/to/legacy.csv --city Ghaziabad
    python import_csv.py path/to/legacy.csv --city all
    python import_csv.py path/to/legacy.csv --dry-run
"""

from __future__ import annotations

import argparse
import logging
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from difflib import SequenceMatcher
from typing import Optional

import pandas as pd

from config import Config
from db import get_app_conn, init_pools, put_app_conn

logger = logging.getLogger("csv_import")


COLUMN_MAP = {
    "Timestamp":                "timestamp",
    "Referred by - Email ID":   "referred_by_email",
    "CP Name":                  "cp_name_csv",
    "Contact":                  "cp_contact",
    "City":                     "city",
    "Society":                  "society_name",
    "Configuration":            "bhk",
    "Size":                     "sqft",
    "Ask Price":                "asking_price",
    "Exit Facing - main gate":  "exit_facing",
    "Flat Status":              "registry_status",
    "Additional Comments":      "additional_comments",
    "Floor":                    "floor",
    "Email Address":            "email",
    "CP Code":                  "cp_code_csv",
    "Okay to visit":            "okay_to_visit",
    "Comment":                  "comment",
    "Unit No":                  "unit_no",
    "Status":                   "csv_status",
}


STATUS_MAP = {
    "":                      "Submitted",
    "followup":              "Submitted",
    "visit to be scheduled": "Submitted",
    "hold":                  "Submitted",
    "visit completed":       "Evaluation",
    "visit scheduled":       "Visit Scheduled",
    "rejected":              "Rejected",
    "sold out":              "Rejected",
}


def map_status(csv_status: Optional[str]) -> str:
    if not csv_status:
        return "Submitted"
    return STATUS_MAP.get(csv_status.strip().lower(), "Submitted")


def clean_str(v, max_len: Optional[int] = None) -> Optional[str]:
    if v is None or pd.isna(v):
        return None
    s = str(v).strip()
    if not s or s.lower() in ("nan", "none", "na", "n/a"):
        return None
    if max_len:
        s = s[:max_len]
    return s


def normalize_phone(v) -> Optional[str]:
    s = clean_str(v)
    if not s:
        return None
    digits = re.sub(r"\D", "", s)
    return digits[-10:] if len(digits) >= 10 else None


def parse_price_lakhs(v) -> Optional[int]:
    s = clean_str(v)
    if not s:
        return None
    s = s.replace("₹", "").replace("Rs.", "").replace("Rs", "").strip()
    lower = s.lower()
    if "cr" in lower or "crore" in lower:
        s = re.sub(r"[a-zA-Z]", "", s).replace(",", "").strip()
        try:
            return int(float(s) * 10_000_000)
        except ValueError:
            return None
    s = re.sub(r"[a-zA-Z]", "", s).replace(",", "").strip()
    try:
        val = float(s)
    except ValueError:
        return None
    if val >= 10000:
        return int(val)
    return int(val * 100_000)


def parse_sqft(v) -> Optional[int]:
    s = clean_str(v)
    if not s:
        return None
    s = re.sub(r"[a-zA-Z.,]", "", s).strip()
    try:
        return int(float(s))
    except ValueError:
        return None


def parse_bhk(v) -> Optional[str]:
    s = clean_str(v)
    if not s:
        return None
    if re.match(r"^\d+\s*(BHK|RK|BR)$", s, re.IGNORECASE):
        return s.upper().replace("  ", " ").strip()
    m = re.match(r"^(\d+)\s*\+?\s*(\d+)?", s)
    if m:
        return f"{m.group(1)} BHK"
    return s[:20]


def parse_timestamp(v) -> Optional[datetime]:
    s = clean_str(v)
    if not s:
        return None
    for fmt in ("%d-%m-%Y", "%m/%d/%Y %H:%M:%S", "%d/%m/%Y %H:%M:%S",
                "%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    try:
        return pd.to_datetime(s, dayfirst=True).to_pydatetime()
    except Exception:  # noqa: BLE001
        return None


CITY_ALIASES = {
    "gurgaon":          "Gurgaon",
    "gurugram":         "Gurgaon",
    "noida":            "Noida",
    "noida extension":  "Noida",
    "greater noida":    "Noida",
    "ghaziabad":        "Ghaziabad",
}


def normalize_city(v) -> Optional[str]:
    s = clean_str(v)
    if not s:
        return None
    return CITY_ALIASES.get(s.lower().strip())


def split_tower_unit(v) -> tuple[Optional[str], Optional[str]]:
    s = clean_str(v, 50)
    if not s:
        return None, None
    m = re.match(r"^Tower[-\s]+([A-Z0-9]+)[-\s]+(\d+)$", s, re.IGNORECASE)
    if m:
        return m.group(1).upper(), m.group(2)
    m = re.match(r"^([A-Z]{1,3}\d?)[\s,\-]+(\d{2,5})$", s, re.IGNORECASE)
    if m:
        return m.group(1).upper(), m.group(2)
    m = re.match(r"^([A-Z]{1,2})(\d{3,5})$", s, re.IGNORECASE)
    if m:
        return m.group(1).upper(), m.group(2)
    if re.match(r"^\d+$", s):
        return None, s
    return None, s[:50]


@dataclass
class LookupCache:
    cp_by_phone: dict = field(default_factory=dict)
    legacy_cp_id: Optional[int] = None
    cities: dict = field(default_factory=dict)
    societies_by_city: dict = field(default_factory=dict)


def build_cache() -> LookupCache:
    cache = LookupCache()
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id, phone, cp_code FROM channel_partners WHERE is_active = TRUE")
            for row in cur.fetchall():
                if row["phone"]:
                    cache.cp_by_phone[row["phone"]] = row["id"]

            cur.execute("SELECT id FROM channel_partners WHERE cp_code = 'LEGACY-IMPORT'")
            legacy = cur.fetchone()
            if not legacy:
                logger.error("LEGACY-IMPORT CP not seeded — run migration.sql first!")
                sys.exit(1)
            cache.legacy_cp_id = legacy["id"]

            cur.execute("SELECT id, name FROM cities")
            for row in cur.fetchall():
                cache.cities[row["name"].lower()] = row["id"]

            cur.execute("SELECT id, name, city_id FROM societies WHERE city_id IS NOT NULL")
            for row in cur.fetchall():
                cache.societies_by_city.setdefault(row["city_id"], []).append(
                    (row["id"], row["name"].lower(), row["name"])
                )
    finally:
        put_app_conn(conn)

    logger.info(
        "Cache: %d CPs, %d cities, %d societies",
        len(cache.cp_by_phone),
        len(cache.cities),
        sum(len(v) for v in cache.societies_by_city.values()),
    )
    return cache


def find_society_fuzzy(society_name: str, city_id: int, cache: LookupCache):
    candidates = cache.societies_by_city.get(city_id, [])
    if not candidates or not society_name:
        return None, None, 0.0
    target = society_name.lower().strip()
    best = max(candidates, key=lambda c: SequenceMatcher(None, target, c[1]).ratio())
    score = SequenceMatcher(None, target, best[1]).ratio()
    return best[0], best[2], score


@dataclass
class ImportStats:
    total: int = 0
    inserted: int = 0
    skipped_no_city: int = 0
    skipped_no_society: int = 0
    skipped_city_filter: int = 0
    linked_legacy_cp: int = 0
    weak_society_match: int = 0
    errors: int = 0
    samples_skipped: list = field(default_factory=list)
    cp_source_counter: Counter = field(default_factory=Counter)
    status_counter: Counter = field(default_factory=Counter)


def import_row(row_dict, cache, stats, dry_run, row_num, city_filter):
    try:
        stats.total += 1

        phone = normalize_phone(row_dict.get("cp_contact"))
        if phone and phone in cache.cp_by_phone:
            cp_id = cache.cp_by_phone[phone]
            stats.cp_source_counter["phone"] += 1
        else:
            cp_id = cache.legacy_cp_id
            stats.cp_source_counter["legacy"] += 1
            stats.linked_legacy_cp += 1

        city_normalized = normalize_city(row_dict.get("city"))
        if not city_normalized:
            stats.skipped_no_city += 1
            stats.samples_skipped.append(
                f"row {row_num}: city {row_dict.get('city')!r} unrecognized"
            )
            return

        if city_filter and city_filter.lower() != "all" and city_filter.lower() != city_normalized.lower():
            stats.skipped_city_filter += 1
            return

        city_id = cache.cities.get(city_normalized.lower())
        if city_id is None:
            stats.skipped_no_city += 1
            return

        society_name_raw = clean_str(row_dict.get("society_name"), 200)
        if not society_name_raw:
            stats.skipped_no_society += 1
            stats.samples_skipped.append(f"row {row_num}: empty society")
            return

        society_id, canonical_name, score = find_society_fuzzy(society_name_raw, city_id, cache)
        if society_id is None:
            stats.skipped_no_society += 1
            return

        is_weak_match = score < 0.6
        if is_weak_match:
            stats.weak_society_match += 1
            logger.warning(
                "row %d weak match: '%s' -> DB '%s' (score %.2f)",
                row_num, society_name_raw, canonical_name, score,
            )

        tower, unit_no = split_tower_unit(row_dict.get("unit_no"))

        comments_parts = []
        for field_name in ("additional_comments", "comment"):
            v = clean_str(row_dict.get(field_name))
            if v:
                comments_parts.append(v)
        additional_comments = "\n\n".join(comments_parts) if comments_parts else None

        pipeline_stage = map_status(clean_str(row_dict.get("csv_status")))
        stats.status_counter[pipeline_stage] += 1

        ts = parse_timestamp(row_dict.get("timestamp")) or datetime.now()

        payload = {
            "cp_id":               cp_id,
            "society_id":          society_id,
            "society_name":        canonical_name or society_name_raw,
            "city_id":             city_id,
            "tower":               tower,
            "unit_no":             unit_no,
            "floor":               clean_str(row_dict.get("floor"), 50),
            "sqft":                parse_sqft(row_dict.get("sqft")),
            "bhk":                 parse_bhk(row_dict.get("bhk")),
            "exit_facing":         clean_str(row_dict.get("exit_facing"), 50),
            "registry_status":     clean_str(row_dict.get("registry_status"), 20),
            "asking_price":        parse_price_lakhs(row_dict.get("asking_price")),
            "closing_price":       None,
            "seller_name":         None,
            "seller_phone":        None,
            "additional_comments": additional_comments,
            "referred_by_email":   clean_str(row_dict.get("referred_by_email"), 200),
            "weak_match":          is_weak_match,
            "status":              pipeline_stage,
            "submitted_at":        ts,
        }

        if dry_run:
            stats.inserted += 1
            return

        conn = get_app_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO submissions (
                        cp_id, society_id, society_name, city_id,
                        tower, unit_no, floor, sqft, bhk,
                        exit_facing, registry_status,
                        asking_price, closing_price,
                        seller_name, seller_phone,
                        additional_comments, referred_by_email, weak_match,
                        status, submitted_at
                    ) VALUES (
                        %(cp_id)s, %(society_id)s, %(society_name)s, %(city_id)s,
                        %(tower)s, %(unit_no)s, %(floor)s, %(sqft)s, %(bhk)s,
                        %(exit_facing)s, %(registry_status)s,
                        %(asking_price)s, %(closing_price)s,
                        %(seller_name)s, %(seller_phone)s,
                        %(additional_comments)s, %(referred_by_email)s, %(weak_match)s,
                        %(status)s, %(submitted_at)s
                    )
                    RETURNING id
                """, payload)
                new_id = cur.fetchone()["id"]

                cur.execute("""
                    INSERT INTO submission_events
                        (submission_id, actor_cp_id, kind, to_status, text)
                    VALUES (%s, %s, 'system', %s, 'Imported from legacy CSV')
                """, (new_id, cp_id, pipeline_stage))

                conn.commit()
        finally:
            put_app_conn(conn)

        stats.inserted += 1

    except Exception as e:  # noqa: BLE001
        stats.errors += 1
        logger.exception("row %d failed: %s", row_num, e)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("csv_path")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--city", default="Noida",
                        help="Noida (default) / Gurgaon / Ghaziabad / all")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")
    Config.validate()
    init_pools()

    logger.info("Reading CSV: %s", args.csv_path)
    logger.info("City filter: %s", args.city)
    df = pd.read_csv(args.csv_path, dtype=str)
    logger.info("CSV has %d rows and %d columns", len(df), len(df.columns))

    df.columns = [c.strip() for c in df.columns]
    rename_map = {c: COLUMN_MAP[c] for c in df.columns if c in COLUMN_MAP}
    unknown = [c for c in df.columns if c not in COLUMN_MAP and c]
    missing = [c for c in COLUMN_MAP if c not in df.columns]
    if unknown:
        logger.warning("Ignoring unknown columns: %s", unknown)
    if missing:
        logger.info("CSV missing columns (will be None): %s", missing)
    df = df.rename(columns=rename_map)

    cache = build_cache()
    stats = ImportStats()

    for idx, row in df.iterrows():
        import_row(row.to_dict(), cache, stats, args.dry_run, idx + 2, args.city)

    logger.info("=" * 60)
    logger.info("IMPORT SUMMARY%s", " (DRY RUN)" if args.dry_run else "")
    logger.info("=" * 60)
    logger.info("Total rows:              %d", stats.total)
    logger.info("Inserted:                %d", stats.inserted)
    logger.info("Skipped (city filter):   %d", stats.skipped_city_filter)
    logger.info("Skipped (no city):       %d", stats.skipped_no_city)
    logger.info("Skipped (no society):    %d", stats.skipped_no_society)
    logger.info("Linked to LEGACY-IMPORT: %d", stats.linked_legacy_cp)
    logger.info("Weak society matches:    %d", stats.weak_society_match)
    logger.info("Errors:                  %d", stats.errors)
    logger.info("")
    logger.info("CP matched via:")
    for source, count in stats.cp_source_counter.most_common():
        logger.info("  %-12s %d", source, count)
    logger.info("")
    logger.info("Pipeline stage distribution:")
    for stage, count in stats.status_counter.most_common():
        logger.info("  %-18s %d", stage, count)
    if stats.samples_skipped:
        logger.info("")
        logger.info("First 10 skipped:")
        for s in stats.samples_skipped[:10]:
            logger.info("  %s", s)


if __name__ == "__main__":
    main()