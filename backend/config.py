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

    # Auth session cookie (HttpOnly JWT). In production the SPA and API are on
    # different origins, so the cookie must be SameSite=None; Secure to be sent
    # cross-site. In dev we serve same-origin via the Vite proxy, so Lax over
    # http works. Override any of these via env in atypical deployments.
    AUTH_COOKIE_NAME = os.getenv("AUTH_COOKIE_NAME", "oh_token")
    _is_prod = ENV != "development"
    AUTH_COOKIE_SECURE = os.getenv(
        "AUTH_COOKIE_SECURE", "true" if _is_prod else "false"
    ).lower() == "true"
    AUTH_COOKIE_SAMESITE = os.getenv(
        "AUTH_COOKIE_SAMESITE", "None" if _is_prod else "Lax"
    )
    AUTH_COOKIE_DOMAIN = os.getenv("AUTH_COOKIE_DOMAIN") or None  # None => host-only

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

    # -------- Partner relay (server-to-server, API key based) --------
    # Shared secret key sent by the partner relay as X-API-Key (configurable).
    # If unset, relay auth is disabled and all callers must use JWT.
    # Generate a long random string (>= 48 chars) for production.
    RELAY_API_KEY = os.getenv("RELAY_API_KEY") or None
    RELAY_API_KEY_HEADER = (os.getenv("RELAY_API_KEY_HEADER") or "X-API-Key").strip() or "X-API-Key"

    # -------- WhatsApp (Interakt) — CP reminder templates --------
    # Interakt API key (basic-auth token; see https://www.interakt.shop/api-docs).
    # Templates expected on the Interakt side:
    #   - cp_visit_reminder        (params: cp_name, tower-unit-society, days_left)
    #   - cp_sellermeeting_reminder(params: cp_name, tower-unit-society, days_left)
    INTERAKT_API_KEY = os.getenv("INTERAKT_API_KEY") or None
    INTERAKT_API_URL = os.getenv(
        "INTERAKT_API_URL", "https://api.interakt.ai/v1/public/message/"
    )
    # Kill-switch: set to "false" to disable outbound WhatsApp without removing creds.
    WA_ENABLED = os.getenv("WA_ENABLED", "true").lower() == "true"
    # Country code prefixed to CP phones before sending. CP rows store
    # 10-digit national numbers; Interakt needs an explicit country code.
    WA_DEFAULT_COUNTRY_CODE = os.getenv("WA_DEFAULT_COUNTRY_CODE", "91")

    # -------- Interakt inbound webhook --------
    # Secret expected on the inbound /api/webhooks/interakt endpoint. Set
    # the SAME value in your Interakt dashboard's webhook settings as a
    # custom header (Authorization: Bearer <token>) so we can reject
    # unauthenticated POSTs. Long random string (>= 48 chars).
    INTERAKT_WEBHOOK_SECRET = os.getenv("INTERAKT_WEBHOOK_SECRET") or None

    # -------- CP reminder cron (X-Sync-Token header) --------
    # Daily job runs in an external scheduler (GitHub Actions / Render cron /
    # cron-job.org) that POSTs to /api/cron/send-cp-reminders. Token shared
    # via this env var. If unset, the cron endpoint returns 503.
    CP_REMINDER_CRON_TOKEN = os.getenv("CP_REMINDER_CRON_TOKEN") or None

    # -------- Forms App integration (Schedule Visit) --------
    # External Forms app handles visit scheduling end-to-end. Admin clicks
    # 'Schedule Visit' on a listing → CP backend POSTs to FORMS_APP_URL +
    # /api/external/schedule with INTERNAL_API_KEY header. Forms app returns
    # a UID we store on the submission.
    FORMS_APP_URL = os.getenv("FORMS_APP_URL") or None
    INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY") or None
    # Timeout for the outbound POST to the Forms app, in seconds.
    FORMS_APP_TIMEOUT_SECONDS = int(os.getenv("FORMS_APP_TIMEOUT_SECONDS", "10"))

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