"""Configuration loaded from environment variables.

Required:  DATABASE_URL, JWT_SECRET
Optional:  PROPERTIES_DATABASE_URL, FRONTEND_ORIGIN, FLASK_ENV
"""

import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    DATABASE_URL = os.getenv("DATABASE_URL")
    PROPERTIES_DATABASE_URL = os.getenv("PROPERTIES_DATABASE_URL") or None
    JWT_SECRET = os.getenv("JWT_SECRET")
    FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
    ENV = os.getenv("FLASK_ENV", "development")

    @classmethod
    def validate(cls) -> None:
        """Raise if any required env var is missing."""
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
