"""Configuration loaded from environment variables."""

import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    DATABASE_URL = os.getenv("DATABASE_URL")
    PROPERTIES_DATABASE_URL = os.getenv("PROPERTIES_DATABASE_URL") or None
    JWT_SECRET = os.getenv("JWT_SECRET")
    FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
    ENV = os.getenv("FLASK_ENV", "development")

    # Gmail SMTP for alerts
    GMAIL_FROM_ADDRESS = os.getenv("GMAIL_FROM_ADDRESS") or None
    GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD") or None
    # Kill-switch: set to "false" to silence alerts without changing code
    ALERTS_ENABLED = os.getenv("ALERTS_ENABLED", "true").lower() == "true"

    # -------- OTP auth (Kaleyra SMS) --------
    # Master switch. If false, login skips OTP (back to phone-only).
    OTP_ENABLED = os.getenv("OTP_ENABLED", "false").lower() == "true"
    # Kaleyra SMS API credentials
    KALEYRA_API_KEY = os.getenv("KALEYRA_API_KEY") or None
    KALEYRA_SID = os.getenv("KALEYRA_SID", "HXIN1815766768IN")
    KALEYRA_SENDER_ID = os.getenv("KALEYRA_SENDER_ID", "OHAVAN")
    KALEYRA_TEMPLATE_ID = os.getenv("KALEYRA_TEMPLATE_ID", "1107173502114302174")
    # Comma-separated list of phone numbers that accept `000000` as a universal bypass.
    # Default includes the admin phone so testing works even without env setup.
    OTP_DEV_BYPASS_PHONES = [
        p.strip() for p in os.getenv(
            "OTP_DEV_BYPASS_PHONES", "9555666059"
        ).split(",") if p.strip()
    ]
    # OTP behavior
    OTP_EXPIRY_MINUTES = int(os.getenv("OTP_EXPIRY_MINUTES", "5"))
    OTP_MAX_ATTEMPTS = int(os.getenv("OTP_MAX_ATTEMPTS", "5"))
    OTP_SEND_RATE_LIMIT = int(os.getenv("OTP_SEND_RATE_LIMIT", "3"))  # sends per 10 min

    # -------- Sync endpoints (Apps Script / Cloud Function callers) --------
    # Shared-secret token the caller must send as 'X-Sync-Token'.
    # Generate a long random string (>= 48 chars). If unset, sync endpoints 503.
    SYNC_SECRET_TOKEN = os.getenv("SYNC_SECRET_TOKEN") or None

    @classmethod
    def validate(cls) -> None:
        missing = []
        if not cls.DATABASE_URL:
            missing.append("DATABASE_URL")
        if not cls.JWT_SECRET or cls.JWT_SECRET == "change-me-to-a-48-char-random-string":
            missing.append("JWT_SECRET")
        if missing:
            raise RuntimeError(
                f"Missing required environment variables: {', '.join(missing)}. "
                "Check your .env file (see .env.example)."
            )