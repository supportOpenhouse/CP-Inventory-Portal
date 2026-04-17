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