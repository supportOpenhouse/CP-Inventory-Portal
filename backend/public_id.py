"""Public ID generator for submissions.

Format: OHL{citycode}C{0001}
  Gurgaon  -> OHLGC0001
  Ghaziabad -> OHLGHC0001
  Noida    -> OHLNC0001

Pattern:
  Takes a cursor + city_name, returns the next public_id string.
  MUST be called inside an already-locked transaction on submissions
  (we SELECT ... FOR UPDATE to prevent two inserts grabbing the same ID).

  Sequence is derived from MAX(public_id) for that city's prefix. If a
  previous submission somehow has a higher number than expected, this
  continues from that number (so gaps are OK, collisions are not).
"""


import re

# Map city name -> ID prefix. Lowercased for lookup, canonical case for prefix.
CITY_PREFIX_MAP = {
    "gurgaon": "G",
    "gurugram": "G",      # some records may spell it this way
    "ghaziabad": "GH",
    "noida": "N",
}


def city_to_prefix(city_name: str) -> str | None:
    if not city_name:
        return None
    return CITY_PREFIX_MAP.get(city_name.strip().lower())


def build_full_prefix(city_name: str) -> str | None:
    """Return the full non-numeric prefix e.g. 'OHLGC', 'OHLGHC', 'OHLNC'."""
    code = city_to_prefix(city_name)
    if code is None:
        return None
    return f"OHL{code}C"


_NUMERIC_SUFFIX = re.compile(r"^OHL(?:G|GH|N)C(\d+)$")


def _extract_number(public_id: str) -> int:
    """Pull the trailing digit-run out of an OHL...C#### id."""
    m = _NUMERIC_SUFFIX.match(public_id or "")
    return int(m.group(1)) if m else 0


def generate_public_id(cur, city_name: str) -> str:
    """Generate the next public_id for a given city.

    Args:
        cur: An active psycopg2 cursor (already inside a transaction).
        city_name: Canonical city name ("Gurgaon", "Ghaziabad", "Noida", etc.).

    Returns:
        Next public_id string, e.g. "OHLGC0042".

    Raises:
        ValueError if the city doesn't have a defined prefix.
    """
    prefix = build_full_prefix(city_name)
    if prefix is None:
        raise ValueError(f"No public_id prefix defined for city: {city_name!r}")

    # Lock the prefix range to serialize concurrent inserts.
    # LIKE on an index-backed pattern is cheap.
    cur.execute("""
        SELECT public_id
        FROM submissions
        WHERE public_id LIKE %s
        ORDER BY public_id DESC
        LIMIT 1
        FOR UPDATE
    """, (f"{prefix}%",))
    row = cur.fetchone()

    last_num = _extract_number(row["public_id"]) if row else 0
    next_num = last_num + 1

    return f"{prefix}{next_num:04d}"
