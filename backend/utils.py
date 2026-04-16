"""Shared helpers: phone normalization and type coercion for request payloads."""

import re


def normalize_phone(raw) -> str | None:
    """Strip non-digits, take last 10 digits. Return None if too short."""
    if not raw or not isinstance(raw, str):
        return None
    digits = re.sub(r"\D", "", raw)
    if len(digits) < 10:
        return None
    return digits[-10:]


def to_int(v):
    """Coerce to int, or None if empty/invalid."""
    if v is None or v == "":
        return None
    try:
        return int(v)
    except (ValueError, TypeError):
        return None


def to_str(v, max_len: int | None = None) -> str | None:
    """Trim + coerce to str. Return None for empty. Optional max length."""
    if v is None:
        return None
    s = str(v).strip()
    if not s:
        return None
    if max_len and len(s) > max_len:
        s = s[:max_len]
    return s
