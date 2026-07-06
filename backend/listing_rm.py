"""Listing-RM resolution + society→RM mapping helpers.

A new submission's owning RM is resolved from the *submission's society*, not
the CP's permanent rm_id. Resolution order at insert time:

  1. society_rm_mappings.rm_id for this submission's society (text)
  2. The city's default RM from the `rms` table — the city's manager (or, if
     none, the lowest-id active RM in that city), matched on the rms.city text.
  3. NULL — admin assigns manually

The resolver intentionally honors an explicit mapping even if the mapped RM
is currently inactive: the mapping is admin-managed, so a deactivated mapping
target is treated as a stale row the admin should fix, not auto-routed away.
"""

from __future__ import annotations

from typing import Optional


def resolve_listing_rm(cur, society: str, city: str) -> Optional[int]:
    """Pick the rm_id that should own a new submission for `society`/`city`.

    Caller passes a cursor on the app DB inside their existing transaction.
    `society` and `city` are text values (matched case-insensitively).
    Returns rm_id or None.
    """
    if society:
        cur.execute(
            "SELECT rm_id FROM society_rm_mappings WHERE LOWER(TRIM(society)) = LOWER(TRIM(%s))",
            (society,),
        )
        row = cur.fetchone()
        if row and row.get("rm_id"):
            return row["rm_id"]

    # City default: the city's RM in the `rms` table — its manager, or (if none)
    # the lowest-id active RM in that city. Matched on the rms.city text column.
    if not city:
        return None

    cur.execute(
        """
        SELECT id
        FROM rms
        WHERE LOWER(TRIM(city)) = LOWER(TRIM(%s))
          AND COALESCE(is_active, TRUE) = TRUE
        ORDER BY COALESCE(is_manager, FALSE) DESC, id ASC
        LIMIT 1
        """,
        (city,),
    )
    row = cur.fetchone()
    if row:
        return row["id"]

    return None


def upsert_society_mapping(cur, society: str, rm_id: int) -> None:
    """Set society→RM mapping for future submissions of `society` (text).

    `society` (text) is the table PK / conflict key. Idempotent: re-pointing the
    same society to a new RM bumps `set_at`. Caller is responsible for the
    transaction; this just runs the UPSERT.
    """
    cur.execute(
        """
        INSERT INTO society_rm_mappings (society, rm_id, set_at)
        VALUES (%s, %s, NOW())
        ON CONFLICT (society) DO UPDATE
            SET rm_id = EXCLUDED.rm_id,
                set_at = NOW()
        """,
        (society, rm_id),
    )
