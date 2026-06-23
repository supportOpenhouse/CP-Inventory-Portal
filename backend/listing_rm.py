"""Listing-RM resolution + society→RM mapping helpers.

A new submission's owning RM is resolved from the *submission's society*, not
the CP's permanent rm_id. Resolution order at insert time:

  1. society_rm_mappings.rm_id for this submission's society_id
  2. The city's designated RM (cities.rm_phone for the society's city,
     matched to rms by last-10-digits of phone). This is how the per-city
     "default RM" is configured — admins set rm_name/rm_phone on the
     `cities` row.
  3. NULL — admin assigns manually

The resolver intentionally honors an explicit mapping even if the mapped RM
is currently inactive: the mapping is admin-managed, so a deactivated mapping
target is treated as a stale row the admin should fix, not auto-routed away.
"""

from __future__ import annotations

from typing import Optional


def resolve_listing_rm(cur, society_id: int) -> Optional[int]:
    """Pick the rm_id that should own a new submission for `society_id`.

    Caller passes a cursor on the app DB inside their existing transaction.
    Returns rm_id or None.
    """
    if not society_id:
        return None

    cur.execute(
        "SELECT rm_id FROM society_rm_mappings WHERE society_id = %s",
        (society_id,),
    )
    row = cur.fetchone()
    if row and row.get("rm_id"):
        return row["rm_id"]

    # City default: cities.rm_phone names the per-city "default RM" by phone.
    # Match it to the rms row by last-10-digit normalization (cities phones
    # are stored with a '+91 ' prefix; rms phones are inconsistently formatted).
    cur.execute(
        """
        SELECT r.id
        FROM societies s
        JOIN cities c       ON c.id = s.city_id
        JOIN rms r          ON RIGHT(REGEXP_REPLACE(r.phone, '\\D', '', 'g'), 10)
                             = RIGHT(REGEXP_REPLACE(c.rm_phone, '\\D', '', 'g'), 10)
        WHERE s.id = %s
          AND c.rm_phone IS NOT NULL
          AND COALESCE(r.is_active, TRUE) = TRUE
        ORDER BY r.id ASC
        LIMIT 1
        """,
        (society_id,),
    )
    row = cur.fetchone()
    if row:
        return row["id"]

    return None


def upsert_society_mapping(cur, society_id: int, rm_id: int) -> None:
    """Set society→RM mapping for future submissions of `society_id`.

    Idempotent: re-pointing the same society to a new RM bumps `set_at`.
    Caller is responsible for the transaction; this just runs the UPSERT.
    """
    cur.execute(
        """
        INSERT INTO society_rm_mappings (society_id, rm_id, set_at)
        VALUES (%s, %s, NOW())
        ON CONFLICT (society_id) DO UPDATE
            SET rm_id = EXCLUDED.rm_id,
                set_at = NOW()
        """,
        (society_id, rm_id),
    )
