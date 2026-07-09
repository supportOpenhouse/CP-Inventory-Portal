"""OTP service: generate, send via Kaleyra, verify.

Security:
- OTPs are stored as SHA-256 hashes, never plaintext.
- Expiry: 5 minutes default.
- Max attempts: 5 per OTP.
- Rate limit: 3 sends per 10 minutes per phone.
- Dev bypass: phones in OTP_DEV_BYPASS_PHONES accept code `000000`.
- Local bypass: a genuinely local (loopback) request accepts `000000` for ANY
  phone, via the gitignored local_bypass module (absent in prod).
- Dev fallback: if KALEYRA_API_KEY is unset, any 6 digits are accepted for
  ANY phone. This prevents prod credentials leaking to dev but keeps
  local testing easy.

Returns from send_otp:
  ("sent", None)               — OTP sent successfully
  ("rate_limited", msg)        — too many sends recently
  ("failed", msg)              — Kaleyra error; OTP NOT persisted
  ("dev_bypass", None)         — dev bypass active; no SMS sent, any 6 digits will pass

Returns from verify_otp:
  ("ok", None)                 — verified
  ("invalid", msg)             — wrong code / expired / max attempts
  ("no_pending", msg)          — no active OTP for this phone
"""

from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import requests

from config import Config
from db import get_app_conn, put_app_conn

logger = logging.getLogger("otp")

# Optional LOCAL DEV OTP bypass — gitignored module, present only on dev
# machines. When present, a genuinely local (loopback) request accepts the code
# '000000' as the OTP for ANY phone (and send_otp skips the real SMS). Absent in
# production → the import fails softly and OTP stays strictly verified.
try:
    from local_bypass import local_dev_request as _local_dev_request
except Exception:  # noqa: BLE001 — module is dev-only / optional
    _local_dev_request = None

_LOCAL_BYPASS_CODE = "000000"


def _local_dev_bypass_active() -> bool:
    return bool(_local_dev_request) and _local_dev_request()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _hash_otp(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def _generate_otp() -> str:
    # secrets.randbelow so codes aren't predictable (random.randint would be fine too)
    return f"{secrets.randbelow(1_000_000):06d}"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _is_dev_bypass_phone(phone: str) -> bool:
    return phone in Config.OTP_DEV_BYPASS_PHONES


def _dev_mode_no_kaleyra() -> bool:
    """True if Kaleyra isn't configured; means we accept any 6 digits."""
    return not Config.KALEYRA_API_KEY


# ---------------------------------------------------------------------------
# Kaleyra SMS
# ---------------------------------------------------------------------------

def _send_sms_via_kaleyra(phone: str, code: str) -> tuple[bool, Optional[str]]:
    """
    Send OTP via Kaleyra HTTP API v2 (JSON body).
    Matches the DLT-approved template at ID 1107173502114302174:
        "Your OTP for login is <var>. Avano Technologies Pvt Ltd."
    Returns (success, error_message).
    """
    sid = Config.KALEYRA_SID
    api_key = Config.KALEYRA_API_KEY
    sender_id = Config.KALEYRA_SENDER_ID
    template_id = Config.KALEYRA_TEMPLATE_ID

    if not api_key:
        return False, "Kaleyra API key not configured"

    # Phone in E.164 format
    to = phone if phone.startswith("+") else f"+91{phone}"

    # v2 endpoint — JSON body with channel, template_id, and template_data
    url = f"https://api.kaleyra.io/v2/{sid}/messages"
    headers = {
        "api-key": api_key,
        "Content-Type": "application/json",
    }
    payload = {
        "to": to,
        "sender": sender_id,
        "type": "OTP",
        "channel": "SMS",
        # DLT template body — must match registered template EXACTLY.
        "body": f"Your OTP for login is {code}. Avano Technologies Pvt Ltd.",
        "template_id": template_id,
        "template_data": {
            "var": str(code),
        },
    }

    logger.info("[OTP] sending to %s via Kaleyra v2 (sender=%s, template=%s)",
                to, sender_id, template_id)

    try:
        r = requests.post(url, headers=headers, json=payload, timeout=8)
        logger.info("[OTP] Kaleyra response status=%d body=%s",
                    r.status_code, r.text[:500])
        # Kaleyra returns 200 OR 202 for success
        if r.status_code in (200, 202):
            return True, None
        return False, f"SMS provider error {r.status_code}: {r.text[:200]}"
    except requests.RequestException as e:  # noqa: BLE001
        logger.exception("[OTP] Kaleyra request exception: %s", e)
        return False, f"SMS provider unreachable: {e}"


# ---------------------------------------------------------------------------
# Main API
# ---------------------------------------------------------------------------

def send_otp(phone: str, ip: Optional[str] = None) -> tuple[str, Optional[str]]:
    """Generate and send an OTP. See module docstring for return contract."""

    # LOCAL DEV: a genuinely local request never sends a real SMS — '000000'
    # will log in (see verify_otp). Gated by the gitignored local_bypass module.
    if _local_dev_bypass_active():
        logger.info("[OTP] local dev request — bypass, no SMS for %s", phone)
        return "dev_bypass", None

    # Dev bypass for specific phones — no SMS, no DB record.
    if _is_dev_bypass_phone(phone):
        logger.info("[OTP] dev bypass phone %s — not sending", phone)
        return "dev_bypass", None

    # Dev mode: Kaleyra not configured — don't insert fake OTPs, just accept anything.
    if _dev_mode_no_kaleyra():
        logger.warning("[OTP] Kaleyra not configured — dev mode (any 6 digits accepted)")
        return "dev_bypass", None

    # Check rate limit: 3 sends per 10 minutes
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT COUNT(*) AS cnt
                FROM otp_tokens
                WHERE phone = %s AND created_at > NOW() - INTERVAL '10 minutes'
            """, (phone,))
            row = cur.fetchone()
            if row and row["cnt"] >= Config.OTP_SEND_RATE_LIMIT:
                return "rate_limited", (
                    f"Too many OTP requests. Wait a few minutes before trying again."
                )

            # Generate + hash
            code = _generate_otp()
            code_hash = _hash_otp(code)
            expires_at = _now() + timedelta(minutes=Config.OTP_EXPIRY_MINUTES)

            # Invalidate any previous unused OTP for this phone
            cur.execute("""
                UPDATE otp_tokens SET used_at = NOW()
                WHERE phone = %s AND used_at IS NULL
            """, (phone,))

            # Send SMS BEFORE inserting — if send fails we don't want stale OTP in DB
            ok, err = _send_sms_via_kaleyra(phone, code)
            if not ok:
                conn.rollback()
                return "failed", err or "Could not send OTP"

            cur.execute("""
                INSERT INTO otp_tokens (phone, otp_hash, expires_at, ip)
                VALUES (%s, %s, %s, %s)
            """, (phone, code_hash, expires_at, ip))
            conn.commit()
    finally:
        put_app_conn(conn)

    return "sent", None


def verify_otp(phone: str, code: str) -> tuple[str, Optional[str]]:
    """Verify an OTP. See module docstring for return contract."""

    # Normalize
    code = (code or "").strip()
    if not code.isdigit() or len(code) != 6:
        return "invalid", "OTP must be 6 digits"

    # LOCAL DEV bypass: on a genuinely local request, '000000' logs in ANY phone
    # — real OTP verification is skipped. Gated by the gitignored local_bypass
    # module, so production (module absent) stays strictly verified.
    if code == _LOCAL_BYPASS_CODE and _local_dev_bypass_active():
        logger.info("[OTP] local bypass — '000000' accepted for %s", phone)
        return "ok", None

    # Dev bypass: specific phones accept ONLY the universal dev code
    if _is_dev_bypass_phone(phone):
        if code == "000000":
            logger.info("[OTP] dev bypass accepted for %s", phone)
            return "ok", None
        return "invalid", "Invalid OTP"

    # Dev mode: Kaleyra unset — any 6 digits pass
    if _dev_mode_no_kaleyra():
        logger.warning("[OTP] dev mode accept (no Kaleyra) for %s", phone)
        return "ok", None

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, otp_hash, expires_at, attempts, used_at
                FROM otp_tokens
                WHERE phone = %s
                ORDER BY created_at DESC
                LIMIT 1
                FOR UPDATE
            """, (phone,))
            row = cur.fetchone()
            if not row:
                return "no_pending", "No OTP requested for this phone. Request a new one."

            # Already used
            if row["used_at"]:
                return "no_pending", "OTP already used. Request a new one."

            # Expired
            if row["expires_at"] < _now():
                return "invalid", "OTP expired. Request a new one."

            # Max attempts
            if row["attempts"] >= Config.OTP_MAX_ATTEMPTS:
                cur.execute(
                    "UPDATE otp_tokens SET used_at = NOW() WHERE id = %s",
                    (row["id"],),
                )
                conn.commit()
                return "invalid", "Too many attempts. Request a new OTP."

            # Bump attempt counter regardless of correctness
            cur.execute(
                "UPDATE otp_tokens SET attempts = attempts + 1 WHERE id = %s",
                (row["id"],),
            )

            expected_hash = row["otp_hash"]
            actual_hash = _hash_otp(code)
            # Use constant-time compare
            if not secrets.compare_digest(expected_hash, actual_hash):
                conn.commit()
                return "invalid", "Invalid OTP"

            # Valid — mark used
            cur.execute(
                "UPDATE otp_tokens SET used_at = NOW() WHERE id = %s",
                (row["id"],),
            )
            conn.commit()
    finally:
        put_app_conn(conn)

    return "ok", None