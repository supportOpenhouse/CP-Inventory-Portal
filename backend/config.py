"""Configuration loaded from environment variables."""

import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    DATABASE_URL = os.getenv("DATABASE_URL")
    PROPERTIES_DATABASE_URL = os.getenv("PROPERTIES_DATABASE_URL") or None
    # Separate DB that holds the `inventory` table (external listings, formerly
    # collated_data). Optional — when unset, inventory-backed features degrade
    # gracefully (dup-check inventory match returns no-match, the External "D
    # Data" view shows nothing, and the inventory sync endpoints return 503).
    INVENTORY_DATABASE_URL = os.getenv("INVENTORY_DATABASE_URL") or None
    JWT_SECRET = os.getenv("JWT_SECRET")
    FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
    ENV = os.getenv("FLASK_ENV", "development")

    # -------- Auth session cookie (HttpOnly) --------
    # The session JWT now rides in an HttpOnly cookie instead of being handed to
    # JS. The SPA reaches the API same-origin (Vercel rewrite in prod, Vite proxy
    # in dev), so the cookie is FIRST-PARTY and SameSite=Lax is sufficient — no
    # SameSite=None third-party cookie (which Safari/Firefox block; that's what
    # sank the earlier attempt).
    AUTH_COOKIE_NAME = os.getenv("AUTH_COOKIE_NAME", "oh_token")
    AUTH_COOKIE_SECURE = os.getenv(
        "AUTH_COOKIE_SECURE", "false" if ENV == "development" else "true"
    ).lower() == "true"
    AUTH_COOKIE_SAMESITE = os.getenv("AUTH_COOKIE_SAMESITE", "Lax")
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
    # Empty by default — no phone bypasses OTP unless explicitly opted in via env.
    OTP_DEV_BYPASS_PHONES = [
        p.strip() for p in os.getenv(
            "OTP_DEV_BYPASS_PHONES", ""
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
    # Headers the relay uses to identify the acting salesperson for on-behalf submissions.
    RELAY_SALES_ID_HEADER = (os.getenv("RELAY_SALES_ID_HEADER") or "X-Sales-Id").strip() or "X-Sales-Id"
    RELAY_SALES_NAME_HEADER = (os.getenv("RELAY_SALES_NAME_HEADER") or "X-Sales-Name").strip() or "X-Sales-Name"

    # -------- Forms App integration (Schedule Visit) --------
    # External Forms app handles visit scheduling end-to-end. Admin clicks
    # 'Schedule Visit' on a listing → CP backend POSTs to FORMS_APP_URL +
    # /api/external/schedule with INTERNAL_API_KEY header. Forms app returns
    # a UID we store on the submission.
    FORMS_APP_URL = os.getenv("FORMS_APP_URL") or None
    INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY") or None
    # Timeout for the outbound POST to the Forms app, in seconds.
    FORMS_APP_TIMEOUT_SECONDS = int(os.getenv("FORMS_APP_TIMEOUT_SECONDS", "10"))

    # -------- Cloudinary (media upload proxy) --------
    # Uploads are proxied through the backend (POST /api/media/upload) so the
    # unsigned preset name stays server-side instead of shipping in the JS
    # bundle. Unsigned upload needs only the cloud name + preset — no secret.
    # If either is unset, the upload endpoint returns 503.
    CLOUDINARY_CLOUD_NAME = os.getenv("CLOUDINARY_CLOUD_NAME") or None
    CLOUDINARY_UPLOAD_PRESET = os.getenv("CLOUDINARY_UPLOAD_PRESET") or None

    # -------- CometChat (in-app chat; replaces Interakt WhatsApp) --------
    COMET_APP_ID = os.getenv("COMET_APP_ID") or None
    COMET_REGION = os.getenv("COMET_REGION") or None
    COMET_REST_API_KEY = os.getenv("COMET_REST_API_KEY") or None
    COMET_AUTH_KEY = os.getenv("COMET_AUTH_KEY") or None
    # Webhook uses HTTP Basic Auth (CometChat does NOT send a Bearer token).
    COMET_WEBHOOK_USER = os.getenv("COMET_WEBHOOK_USER") or None
    COMET_WEBHOOK_PASS = os.getenv("COMET_WEBHOOK_PASS") or None
    # Shared staff identity all admins/RMs reply as.
    COMET_STAFF_UID = os.getenv("COMET_STAFF_UID", "openhouse")

    @classmethod
    def validate(cls) -> None:
        missing = []
        if not cls.DATABASE_URL:
            missing.append("DATABASE_URL")
        if not cls.JWT_SECRET or cls.JWT_SECRET == "change-me-to-a-48-char-random-string":
            missing.append("JWT_SECRET")
        # If OTP is enabled, the SMS provider MUST be configured. Otherwise
        # verify_otp falls open (any 6 digits log in any phone) — fail closed
        # at startup instead of silently disabling authentication.
        if cls.OTP_ENABLED and not cls.KALEYRA_API_KEY:
            missing.append("KALEYRA_API_KEY (required when OTP_ENABLED=true)")
        if missing:
            raise RuntimeError(
                f"Missing required environment variables: {', '.join(missing)}. "
                "Check your .env file (see .env.example)."
            )