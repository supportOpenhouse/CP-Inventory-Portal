"""Gmail SMTP email sender for new-submission alerts.

Fire-and-forget via a background thread so the API response isn't slow.
Kill-switch via ALERTS_ENABLED env var.
"""

import logging
import smtplib
import threading
from email.message import EmailMessage

from config import Config
from db import get_app_conn, put_app_conn

logger = logging.getLogger(__name__)


# ---- Formatting helpers ----

def _fmt_price(v):
    if not v:
        return "—"
    try:
        n = int(v)
    except (ValueError, TypeError):
        return "—"
    if n >= 10_000_000:
        return f"₹{n / 10_000_000:.2f} Cr"
    if n >= 100_000:
        return f"₹{n / 100_000:.1f} L"
    return f"₹{n:,}"


def _fmt_rate(asking, sqft):
    if not asking or not sqft:
        return ""
    try:
        rate = round(int(asking) / int(sqft))
        return f" (₹{rate:,}/sqft)"
    except (ValueError, TypeError, ZeroDivisionError):
        return ""


def _build_email(submission: dict, cp: dict, rm_name: str) -> tuple[str, str]:
    """Returns (subject, body_text)."""
    society = submission.get("society_name") or "Unknown society"
    city = submission.get("city") or ""
    cp_code = cp.get("cp_code") or ""

    subject = f"New CP submission — {society} ({city}) — {cp_code}"

    tower_unit = ""
    if submission.get("tower") or submission.get("unit_no"):
        parts = []
        if submission.get("tower"):
            parts.append(f"Tower {submission['tower']}")
        if submission.get("unit_no"):
            parts.append(f"Unit {submission['unit_no']}")
        if submission.get("floor"):
            parts.append(f"Floor {submission['floor']}")
        tower_unit = ", ".join(parts)

    config_line = []
    if submission.get("bhk"):
        config_line.append(submission["bhk"])
    if submission.get("sqft"):
        config_line.append(f"{submission['sqft']} sqft")
    if submission.get("registry_status"):
        config_line.append(submission["registry_status"])
    config = " · ".join(config_line) or "—"

    asking = _fmt_price(submission.get("asking_price"))
    rate = _fmt_rate(submission.get("asking_price"), submission.get("sqft"))
    closing = _fmt_price(submission.get("closing_price"))

    seller_line = "Not provided"
    if submission.get("seller_name") or submission.get("seller_phone"):
        parts = []
        if submission.get("seller_name"):
            parts.append(submission["seller_name"])
        if submission.get("seller_phone"):
            parts.append(f"(+91 {submission['seller_phone']})")
        seller_line = " ".join(parts)

    body = f"""Hi {rm_name},

A new unit has been submitted in your area:

Society: {society}
{("Location: " + tower_unit) if tower_unit else ""}
Config: {config}
Asking price: {asking}{rate}
Closing price: {closing}

Submitted by: {cp.get('name', 'Unknown')} ({cp_code}) · {cp.get('company') or '—'}
Phone: +91 {cp.get('phone', '')}

Seller: {seller_line}

View in admin dashboard → https://cp-inventory-portal.vercel.app

—
Automated alert from Openhouse CP Portal
""".strip()

    return subject, body


# ---- SMTP send ----

def _send_smtp(to_address: str, subject: str, body: str) -> None:
    """Blocking SMTP send. Call from a background thread."""
    if not Config.GMAIL_FROM_ADDRESS or not Config.GMAIL_APP_PASSWORD:
        logger.warning("Gmail SMTP creds missing; skipping email.")
        return

    msg = EmailMessage()
    msg["From"] = f"Openhouse Alerts <{Config.GMAIL_FROM_ADDRESS}>"
    msg["To"] = to_address
    msg["Subject"] = subject
    msg.set_content(body)

    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=15) as server:
            server.login(Config.GMAIL_FROM_ADDRESS, Config.GMAIL_APP_PASSWORD)
            server.send_message(msg)
        logger.info("Alert email sent to %s: %s", to_address, subject)
    except Exception as e:
        logger.error("Failed to send alert email to %s: %s", to_address, e)


# ---- Public API ----

def send_new_submission_alert_async(submission_id: int) -> None:
    """Kick off email send in a background thread. Non-blocking."""
    if not Config.ALERTS_ENABLED:
        return
    thread = threading.Thread(
        target=_send_new_submission_alert_sync,
        args=(submission_id,),
        daemon=True,
    )
    thread.start()


def _send_new_submission_alert_sync(submission_id: int) -> None:
    """Resolve RM + CP + submission and send the email. Safe to run in background."""
    try:
        conn = get_app_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT
                        s.id, s.society_name, s.tower, s.unit_no, s.floor,
                        s.sqft, s.bhk, s.asking_price, s.closing_price,
                        s.registry_status, s.seller_name, s.seller_phone,
                        c.name AS city,
                        cp.cp_code, cp.name AS cp_name, cp.phone AS cp_phone,
                        cp.company AS cp_company,
                        rm.name AS rm_name, rm.email AS rm_email
                    FROM submissions s
                    LEFT JOIN cities c ON s.city_id = c.id
                    JOIN channel_partners cp ON s.cp_id = cp.id
                    LEFT JOIN channel_partners rm
                        ON rm.city_id = s.city_id AND rm.role = 'rm'
                    WHERE s.id = %s
                """, (submission_id,))
                row = cur.fetchone()
        finally:
            put_app_conn(conn)

        if not row:
            logger.warning("submission %s not found for alert", submission_id)
            return

        rm_email = row.get("rm_email")
        rm_name = row.get("rm_name") or "team"
        if not rm_email:
            logger.warning(
                "No RM email for submission %s (city=%s); skipping alert",
                submission_id, row.get("city"),
            )
            return

        submission_data = {
            "society_name": row["society_name"],
            "tower": row["tower"],
            "unit_no": row["unit_no"],
            "floor": row["floor"],
            "sqft": row["sqft"],
            "bhk": row["bhk"],
            "asking_price": row["asking_price"],
            "closing_price": row["closing_price"],
            "registry_status": row["registry_status"],
            "seller_name": row["seller_name"],
            "seller_phone": row["seller_phone"],
            "city": row["city"],
        }
        cp_data = {
            "cp_code": row["cp_code"],
            "name": row["cp_name"],
            "phone": row["cp_phone"],
            "company": row["cp_company"],
        }

        subject, body = _build_email(submission_data, cp_data, rm_name)
        _send_smtp(rm_email, subject, body)
    except Exception as e:
        logger.exception("Alert email pipeline failed: %s", e)
