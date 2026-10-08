"""CometChat REST helpers: user provisioning + auth tokens.

Management REST base: https://{APP_ID}.api-{REGION}.cometchat.io/v3
Auth header: apikey: {COMET_REST_API_KEY}
"""
import logging
import requests

from config import Config

log = logging.getLogger(__name__)
_TIMEOUT = 10


def configured() -> bool:
    return bool(Config.COMET_APP_ID and Config.COMET_REGION
                and Config.COMET_REST_API_KEY)


def _base() -> str:
    return f"https://{Config.COMET_APP_ID}.api-{Config.COMET_REGION}.cometchat.io/v3"


def _headers() -> dict:
    return {
        "accept": "application/json",
        "content-type": "application/json",
        "apikey": Config.COMET_REST_API_KEY,
    }


def cometchat_uid(user: dict) -> str:
    """Portal user -> CometChat uid. CP -> 'cp_<id>'; any staff -> shared uid."""
    if user.get("role") == "cp" and user.get("cp_id") is not None:
        return f"cp_{user['cp_id']}"
    return Config.COMET_STAFF_UID


def ensure_user(uid: str, name: str, city: str | None = None) -> None:
    """Create the CometChat user, or UPDATE its name/tags if it already exists.

    Upsert (not just create-if-missing): a user first created with a placeholder
    name (e.g. a phone number) gets corrected to the real name on the next call.
    Idempotent. CP users (uid 'cp_*') are tagged 'cp' (+ 'city:<city>' when known)
    so the admin inbox can list all CP users via a tag filter. (CometChat 'role'
    is NOT used — arbitrary roles must be pre-defined in the dashboard.)
    """
    tags = []
    if uid.startswith("cp_"):
        tags.append("cp")
    if city:
        tags.append(f"city:{city}")
    body = {"uid": uid, "name": name or uid}
    if tags:
        body["tags"] = tags
    try:
        r = requests.post(f"{_base()}/users", json=body, headers=_headers(), timeout=_TIMEOUT)
        if r.status_code in (200, 201):
            return
        # Already exists → PUT to update its name (+ tags) so it stays current.
        if r.status_code == 409 or "ALREADY_EXISTS" in r.text:
            update = {"name": body["name"]}
            if tags:
                update["tags"] = tags
            ru = requests.put(f"{_base()}/users/{uid}", json=update, headers=_headers(), timeout=_TIMEOUT)
            if ru.status_code not in (200, 201):
                log.warning("[comet] update_user uid=%s status=%s body=%s", uid, ru.status_code, ru.text[:300])
            return
        log.warning("[comet] ensure_user uid=%s status=%s body=%s", uid, r.status_code, r.text[:300])
    except requests.RequestException as e:
        log.warning("[comet] ensure_user uid=%s transport error: %s", uid, e)


def send_text_message(from_uid: str, to_uid: str, text: str):
    """Send a 1:1 text message on behalf of `from_uid` to `to_uid` via REST.

    Used by the /send proxy and the admin broadcast fan-out (from_uid='openhouse').
    CometChat sends "on behalf of" a user via the `onBehalfOf` header. Returns the
    new CometChat message id (a truthy str) on success, or None on failure — so
    callers can both boolean-test it and persist the id for dedup.
    """
    headers = dict(_headers())
    headers["onBehalfOf"] = from_uid
    body = {
        "receiver": to_uid,
        "receiverType": "user",
        "category": "message",
        "type": "text",
        "data": {"text": text},
    }
    try:
        r = requests.post(f"{_base()}/messages", json=body, headers=headers, timeout=_TIMEOUT)
        if r.status_code in (200, 201):
            try:
                return str(r.json()["data"]["id"])
            except (KeyError, ValueError, TypeError):
                log.warning("[comet] send_message %s->%s: 2xx but no message id (%s)", from_uid, to_uid, r.text[:200])
                return None
        log.warning("[comet] send_message %s->%s status=%s body=%s", from_uid, to_uid, r.status_code, r.text[:200])
        return None
    except requests.RequestException as e:
        log.warning("[comet] send_message %s->%s transport error: %s", from_uid, to_uid, e)
        return None


def issue_auth_token(uid: str) -> str:
    """Return a fresh CometChat auth token for uid. Raises on failure."""
    r = requests.post(f"{_base()}/users/{uid}/auth_tokens", json={}, headers=_headers(), timeout=_TIMEOUT)
    r.raise_for_status()
    return r.json()["data"]["authToken"]


def revoke_auth_tokens(uid: str) -> bool:
    """Revoke ALL of a user's CometChat auth tokens — they can't chat until a
    new token is issued (which the gate refuses while disabled). Keeps the user
    + conversation history. Best-effort; returns True on success.
    """
    try:
        r = requests.delete(f"{_base()}/users/{uid}/auth_tokens", headers=_headers(), timeout=_TIMEOUT)
        if r.status_code in (200, 204):
            return True
        log.warning("[comet] revoke_auth_tokens uid=%s status=%s body=%s", uid, r.status_code, r.text[:200])
        return False
    except requests.RequestException as e:
        log.warning("[comet] revoke_auth_tokens uid=%s transport error: %s", uid, e)
        return False
