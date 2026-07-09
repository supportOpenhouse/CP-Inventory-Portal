# CometChat Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the WhatsApp/Interakt two-way messaging with CometChat in-app chat (shared "openhouse" identity, React UI Kit, role-scoped inbox, webhook-backed persistence to a new `chat_messages` table).

**Architecture:** Every CP is a CometChat user `cp_<id>` (tagged with city); one shared `openhouse` user is the org counterpart. Staff operate the inbox logged into CometChat as `openhouse`. A backend endpoint provisions CometChat users and issues auth tokens; a CometChat webhook persists every message to a new `chat_messages` table + activity log. Interakt is torn down; the old `whatsapp_messages` table is kept but never written to again.

**Tech Stack:** Python/Flask + psycopg2 (backend), React + Vite (frontend), CometChat React UI Kit + Chat SDK, Postgres (Neon).

## Global Constraints

- **PLAN/PROD BLOCKER (record, not code):** CometChat **Build (free) plan caps at 100 users / 100 MAU**. This app has ~3000 CPs (`cp_<id>`), so **Build can run dev/testing only — production needs a paid tier** sized for ~3000 users. The shared `openhouse` staff user is 1 MAU (all staff share it), so staff don't add to the count; the CP identities are the constraint.
  - **Decision (2026-07-09):** build + test on **Build for now** with a limited set of test CPs (keep distinct CP logins **< ~90**); upgrade the tier once the integration proves out, **before production rollout**. App: *Openhouse Partner App*, App ID `16806918e9cd660a1`, region `in`.
- CometChat React UI Kit target: **`@cometchat/chat-uikit-react` v7 (7.0.3)** + `@cometchat/chat-sdk-javascript` v4 + `dompurify` + **`@cometchat/calls-sdk-javascript`**. The last one is REQUIRED even though calling is out of scope: UI Kit v7 has a guarded dynamic `import("@cometchat/calls-sdk-javascript")`, and Vite dev import-analysis + `vite build` hard-fail if it isn't installed. It's only lazy-loaded when a call is actually started, so installing it does not enable calling. (Verified against current docs. v7 removed the v4/v6 composite components — see the v7 component mapping.)
- **v7 component mapping** (the v6 composites the plan drafts referenced do NOT exist in v7): a combined inbox = `CometChatConversations` (list) + on-select render `CometChatMessageHeader` + `CometChatMessageList` + `CometChatMessageComposer`; a single-user thread = `CometChatMessageList user={peer}` (+ header/composer). `user`/`group` props are mutually exclusive. Inject a request builder via the `conversationsRequestBuilder` prop on `CometChatConversations` (pass the builder instance, not `.build()`).
- **REQUIRED: `CometChatProvider` wrapper.** v7 UI-Kit components (`CometChatConversations`, `CometChatMessageList`, etc.) call `usePluginRegistry()` and throw `no CometChatPluginRegistryContext found` — white-screening the app — unless wrapped in `<CometChatProvider>…</CometChatProvider>`. It has no required props. Wrap each surface's UI-Kit tree in it, rendered AFTER `loginCometChat()` completes (SDK init'd). Also wrap in an error boundary so any UI-Kit render throw shows a message instead of a blank page.
- Env keys (`COMET_` convention). Backend: `COMET_APP_ID`, `COMET_REGION`, `COMET_REST_API_KEY`, `COMET_AUTH_KEY`, `COMET_WEBHOOK_USER`, `COMET_WEBHOOK_PASS`. Frontend: `VITE_COMET_APP_ID`, `VITE_COMET_REGION` (auth key stays server-side; the browser only logs in via a server-issued token). **Already in `.env`:** `COMET_AUTH_KEY`, `COMET_REST_API_KEY`. **STILL NEEDED:** `COMET_APP_ID` + `COMET_REGION`.
- CometChat REST management base URL: `https://{APP_ID}.api-{REGION}.cometchat.io/v3`, auth header `apikey: {COMET_REST_API_KEY}`. Verified: `POST /v3/users` (create), `POST /v3/users/{uid}/auth_tokens` → token at `data.authToken`.
- **CometChat webhook auth is HTTP Basic Auth, NOT Bearer.** The webhook sends `Authorization: Basic base64(user:pass)`; validate `request.authorization.username/password`. Do not copy the Interakt Bearer pattern.
- CP CometChat uid = `cp_<submissions.cp_id>` (e.g. `cp_5090`); shared staff uid = `openhouse`.
- Role scoping: portal role `admin` → all CP conversations; `manager`/`rm` → only their cities' CPs (via `city` tag). Scoping is decided from the portal JWT, never from CometChat identity.
- Do NOT drop or write to `whatsapp_messages`. New logs go to `chat_messages` only.
- Reminders cron (`routes/cron.py`, `cp_reminders_sent`) is OUT OF SCOPE — do not touch.
- No pytest harness exists in this repo. "Tests" are standalone `assert`-based scripts run with `./backend/venv/bin/python`, plus explicit manual-verification steps for UI/integration. Do not add a test framework.
- Backend DB access pattern: `conn = get_app_conn()` / `put_app_conn(conn)`; cursors are `RealDictCursor` (rows support `row["col"]`).

---

## File structure

**Backend**
- Modify `backend/config.py` — add `COMET_*` config.
- Create `backend/services_cometchat.py` — REST helpers: uid resolution, `ensure_user`, `issue_auth_token`.
- Create `backend/routes/comet.py` — `POST /api/comet/auth-token`.
- Create `backend/migrations/2026-07-09-chat-messages.sql` — `chat_messages` table.
- Modify `backend/routes/webhooks.py` — add `POST /api/webhooks/cometchat`.
- Modify `backend/app.py` — register comet blueprint; mark webhook + token routes appropriately for auth.
- Teardown (Task 9): `backend/services_whatsapp.py`, `backend/routes/webhooks.py` (Interakt handler), `backend/routes/admin.py` (`/whatsapp/*` endpoints), `backend/config.py` (Interakt/WA config).

**Frontend**
- Create `frontend/src/cometchat.js` — init + login-with-token helper.
- Modify `frontend/src/api.js` — `getCometAuthToken()`; remove WhatsApp methods (Task 9).
- Create `frontend/src/screens/Admin/ChatInbox.jsx` — UI Kit conversations, role-scoped.
- Modify `frontend/src/screens/Admin/index.jsx` — swap WhatsAppInbox → ChatInbox.
- Modify `frontend/src/screens/Admin/DetailPanel.jsx` — swap WhatsAppThread → CometChat message view for `cp_<id>`.
- Modify `frontend/src/screens/Dashboard.jsx` — add CP chat widget.
- Teardown (Task 9): delete `WhatsAppInbox.jsx`, `WhatsAppThread.jsx`.

---

## Task 1: CometChat REST service + uid resolution

**Files:**
- Modify: `backend/config.py` (add config block near the Interakt block ~line 79)
- Create: `backend/services_cometchat.py`
- Test: `backend/tests_cometchat_uid.py` (standalone assert script)

**Interfaces:**
- Produces: `services_cometchat.cometchat_uid(user: dict) -> str`, `services_cometchat.ensure_user(uid, name, city=None) -> None`, `services_cometchat.issue_auth_token(uid) -> str`, `services_cometchat.configured() -> bool`.

- [ ] **Step 1: Add config** — in `backend/config.py`, after the Interakt block, add:

```python
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
```

- [ ] **Step 2: Write the failing test** — `backend/tests_cometchat_uid.py`:

```python
import sys; sys.path.insert(0, "backend")
from services_cometchat import cometchat_uid

# CP -> cp_<id>
assert cometchat_uid({"role": "cp", "cp_id": 5090}) == "cp_5090"
# staff roles -> shared openhouse uid
for role in ("admin", "manager", "rm", "viewer"):
    assert cometchat_uid({"role": role, "cp_id": None}) == "openhouse", role
print("PASS")
```

- [ ] **Step 3: Run it, expect failure**

Run: `./backend/venv/bin/python backend/tests_cometchat_uid.py`
Expected: `ModuleNotFoundError` / `ImportError` (module not yet created).

- [ ] **Step 4: Implement `backend/services_cometchat.py`:**

```python
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
    """Create the CometChat user if missing (idempotent). Tags with city when given."""
    body = {"uid": uid, "name": name or uid}
    if city:
        body["tags"] = [f"city:{city}"]
    try:
        r = requests.post(f"{_base()}/users", json=body, headers=_headers(), timeout=_TIMEOUT)
        # 200 = created; 409/ERR_UID_ALREADY_EXISTS = already there (fine).
        if r.status_code not in (200, 201) and "ALREADY_EXISTS" not in r.text:
            log.warning("[comet] ensure_user uid=%s status=%s body=%s", uid, r.status_code, r.text[:300])
    except requests.RequestException as e:
        log.warning("[comet] ensure_user uid=%s transport error: %s", uid, e)


def issue_auth_token(uid: str) -> str:
    """Return a fresh CometChat auth token for uid. Raises on failure."""
    r = requests.post(f"{_base()}/users/{uid}/auth_tokens", json={}, headers=_headers(), timeout=_TIMEOUT)
    r.raise_for_status()
    return r.json()["data"]["authToken"]
```

- [ ] **Step 5: Run test, expect PASS**

Run: `./backend/venv/bin/python backend/tests_cometchat_uid.py`
Expected: `PASS`

- [ ] **Step 6: Byte-compile check**

Run: `./backend/venv/bin/python -m py_compile backend/config.py backend/services_cometchat.py`
Expected: no output (success).

- [ ] **Step 7: Commit**

```bash
git add backend/config.py backend/services_cometchat.py backend/tests_cometchat_uid.py
git commit -m "feat(comet): CometChat REST service + uid resolution"
```

---

## Task 2: `chat_messages` table

**Files:**
- Create: `backend/migrations/2026-07-09-chat-messages.sql`

**Interfaces:**
- Produces: table `chat_messages` with columns used by Task 4's webhook insert.

- [ ] **Step 1: Write the migration** — `backend/migrations/2026-07-09-chat-messages.sql`:

```sql
-- New chat log for CometChat messages (both directions). Replaces writes to
-- whatsapp_messages, which is staled out (kept for history, never written again).
CREATE TABLE IF NOT EXISTS chat_messages (
    id              SERIAL PRIMARY KEY,
    direction       VARCHAR(10) NOT NULL,           -- 'inbound' (from CP) | 'outbound' (from staff)
    cp_id           INTEGER REFERENCES channel_partners(id),
    sender_uid      VARCHAR(64) NOT NULL,           -- 'cp_<id>' or 'openhouse'
    staff_id        INTEGER,                        -- which admin/rm sent it (from msg metadata); nullable
    body            TEXT,
    comet_message_id VARCHAR(120) UNIQUE,           -- CometChat message id (dedup)
    conversation_id VARCHAR(120),
    submission_id   INTEGER,
    sent_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_cp         ON chat_messages(cp_id);
CREATE INDEX IF NOT EXISTS idx_chat_submission ON chat_messages(submission_id);
CREATE INDEX IF NOT EXISTS idx_chat_created    ON chat_messages(created_at DESC);
```

- [ ] **Step 2: Validate SQL parses (dry-run, rolled back)** — this is DDL against prod; it requires the user to run it. Provide the file and note it in the handoff. Do NOT auto-run.

Verification the implementer performs manually via the Neon console:
```sql
BEGIN; \i backend/migrations/2026-07-09-chat-messages.sql ROLLBACK;
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/migrations/2026-07-09-chat-messages.sql
git commit -m "feat(comet): chat_messages table migration"
```

---

## Task 3: Auth-token endpoint

**Files:**
- Create: `backend/routes/comet.py`
- Modify: `backend/app.py` (import + register blueprint)

**Interfaces:**
- Consumes: `services_cometchat.{configured,cometchat_uid,ensure_user,issue_auth_token}`, `auth.require_auth`, `flask.g.user`.
- Produces: `POST /api/comet/auth-token` → `{ "uid": str, "authToken": str, "appId": str, "region": str }`.

- [ ] **Step 1: Implement `backend/routes/comet.py`:**

```python
"""CometChat auth: provision the caller's CometChat user + return an auth token."""
from flask import Blueprint, g, jsonify

from auth import require_auth
from config import Config
import services_cometchat as comet

bp = Blueprint("comet", __name__, url_prefix="/api/comet")


@bp.post("/auth-token")
@require_auth
def auth_token():
    if not comet.configured():
        return jsonify({"error": "Chat is not configured."}), 503

    user = g.user
    uid = comet.cometchat_uid(user)
    if uid == Config.COMET_STAFF_UID:
        name, city = "Openhouse", None
    else:
        name = user.get("name") or user.get("phone") or uid
        city = user.get("city")

    comet.ensure_user(uid, name, city)
    try:
        token = comet.issue_auth_token(uid)
    except Exception as e:  # noqa: BLE001 - surface as 502, chat is non-critical
        return jsonify({"error": f"Could not start chat: {e}"}), 502

    return jsonify({
        "uid": uid,
        "authToken": token,
        "appId": Config.COMET_APP_ID,
        "region": Config.COMET_REGION,
    }), 200
```

- [ ] **Step 2: Register blueprint** — in `backend/app.py`, next to the other `register_blueprint` calls, add:

```python
    from routes.comet import bp as comet_bp
    app.register_blueprint(comet_bp)
```

- [ ] **Step 3: Byte-compile check**

Run: `./backend/venv/bin/python -m py_compile backend/routes/comet.py backend/app.py`
Expected: no output.

- [ ] **Step 4: Manual smoke test** (requires `COMET_*` env set + `flask run`):
Log in as an admin, then:
```bash
curl -s -X POST localhost:5000/api/comet/auth-token -b "oh_token=<admin cookie>" | python -m json.tool
```
Expected: JSON with `uid=="openhouse"`, a non-empty `authToken`, `appId`, `region`. As a CP: `uid=="cp_<id>"`.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/comet.py backend/app.py
git commit -m "feat(comet): POST /api/comet/auth-token endpoint"
```

---

## Task 4: CometChat webhook → `chat_messages` + activity log

**Files:**
- Modify: `backend/routes/webhooks.py` (add handler + helpers)
- Test: `backend/tests_comet_webhook.py` (standalone assert script for the parse/dedup helper)

**Interfaces:**
- Consumes: `get_app_conn`/`put_app_conn`, `activity_log.log_activity`, `Config.COMET_WEBHOOK_USER`/`COMET_WEBHOOK_PASS`.
- Produces: `POST /api/webhooks/cometchat`; helper `_parse_comet_message(payload) -> dict|None` returning `{comet_message_id, sender_uid, direction, cp_id, staff_id, body, conversation_id, sent_at}`.

- [ ] **Step 1: Write the failing test** — `backend/tests_comet_webhook.py`:

```python
import sys; sys.path.insert(0, "backend")
from routes.webhooks import _parse_comet_message

# CP -> openhouse (inbound); text message
payload = {"data": {
    "id": "abc123", "sender": "cp_5090", "receiverType": "user",
    "receiver": "openhouse", "category": "message", "type": "text",
    "data": {"text": "hi", "metadata": {}}, "sentAt": 1751000000,
}}
m = _parse_comet_message(payload)
assert m["comet_message_id"] == "abc123"
assert m["direction"] == "inbound"
assert m["cp_id"] == 5090
assert m["sender_uid"] == "cp_5090"
assert m["body"] == "hi"
assert m["staff_id"] is None

# staff -> cp (outbound) with staff attribution in metadata
payload2 = {"data": {
    "id": "def456", "sender": "openhouse", "receiver": "cp_5090",
    "receiverType": "user", "category": "message", "type": "text",
    "data": {"text": "hello", "metadata": {"staff_id": 42}}, "sentAt": 1751000100,
}}
m2 = _parse_comet_message(payload2)
assert m2["direction"] == "outbound"
assert m2["cp_id"] == 5090
assert m2["sender_uid"] == "openhouse"
assert m2["staff_id"] == 42

# non-message event -> None
assert _parse_comet_message({"trigger": "typing_started", "data": {}}) is None
print("PASS")
```

- [ ] **Step 2: Run it, expect failure**

Run: `./backend/venv/bin/python backend/tests_comet_webhook.py`
Expected: `ImportError: cannot import name '_parse_comet_message'`.

- [ ] **Step 3: Add handler + helpers to `backend/routes/webhooks.py`** (append; reuse existing `log`/imports, add `from config import Config`, `from activity_log import log_activity`, `hmac`, `hashlib`):

```python
import re as _re

_CP_UID = _re.compile(r"^cp_(\d+)$")


def _uid_cp_id(uid):
    m = _CP_UID.match(uid or "")
    return int(m.group(1)) if m else None


def _parse_comet_message(payload):
    """Extract a chat_messages row from a CometChat 'message_sent' webhook, or None."""
    # CometChat envelope: {trigger, data: {<message>}, appId, webhook}. Message
    # fields sit DIRECTLY under data — there is no data.message level.
    msg = (payload or {}).get("data")
    if not isinstance(msg, dict) or msg.get("category") != "message":
        return None
    sender = msg.get("sender")
    receiver = msg.get("receiver")
    staff_uid = Config.COMET_STAFF_UID
    if sender == staff_uid:
        direction, cp_id = "outbound", _uid_cp_id(receiver)
    else:
        direction, cp_id = "inbound", _uid_cp_id(sender)
    meta = (msg.get("data") or {}).get("metadata") or {}
    return {
        "comet_message_id": msg.get("id"),
        "sender_uid": sender,
        "direction": direction,
        "cp_id": cp_id,
        "staff_id": meta.get("staff_id"),
        "body": (msg.get("data") or {}).get("text"),
        "conversation_id": msg.get("conversationId"),
        "sent_at": msg.get("sentAt"),
    }


@bp.post("/cometchat")
def cometchat_webhook():
    # CometChat sends HTTP Basic Auth (Authorization: Basic base64(user:pass)),
    # NOT a Bearer token. Flask parses it into request.authorization.
    import hmac as _hmac
    auth = request.authorization
    u, p = Config.COMET_WEBHOOK_USER, Config.COMET_WEBHOOK_PASS
    if (not u or not p or auth is None
            or not _hmac.compare_digest(auth.username or "", u)
            or not _hmac.compare_digest(auth.password or "", p)):
        return jsonify({"error": "unauthorized"}), 401

    row = _parse_comet_message(request.get_json(silent=True) or {})
    if not row or not row["comet_message_id"]:
        return jsonify({"ok": True, "skipped": True}), 200

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO chat_messages
                    (direction, cp_id, sender_uid, staff_id, body,
                     comet_message_id, conversation_id, sent_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s, to_timestamp(%s))
                ON CONFLICT (comet_message_id) DO NOTHING
                RETURNING id
                """,
                (row["direction"], row["cp_id"], row["sender_uid"], row["staff_id"],
                 row["body"], row["comet_message_id"], row["conversation_id"],
                 row["sent_at"]),
            )
            inserted = cur.fetchone()
            if inserted and row["direction"] == "inbound" and row["cp_id"]:
                log_activity(cur, actor_cp_id=row["cp_id"], action="cp_chat_reply",
                             category="cp_chat", meta={"chat_message_id": inserted["id"]})
            conn.commit()
    finally:
        put_app_conn(conn)
    return jsonify({"ok": True}), 200
```

Note: verify `log_activity`'s exact signature in `backend/activity_log.py` and match it (the existing Interakt handler calls it — copy that call shape).

- [ ] **Step 4: Run test, expect PASS**

Run: `./backend/venv/bin/python backend/tests_comet_webhook.py`
Expected: `PASS`

- [ ] **Step 5: Ensure webhook route is auth-exempt** — in `backend/app.py`, the auth layer exempts webhook paths (Interakt's `/api/webhooks/interakt` is already exempt). Add `/api/webhooks/cometchat` to the same exemption list/prefix. Byte-compile:

Run: `./backend/venv/bin/python -m py_compile backend/routes/webhooks.py backend/app.py`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/webhooks.py backend/app.py backend/tests_comet_webhook.py
git commit -m "feat(comet): CometChat webhook -> chat_messages + activity log"
```

---

## Task 5: Frontend CometChat init/login helper + api method

**Files:**
- Create: `frontend/src/cometchat.js`
- Modify: `frontend/src/api.js` (add `getCometAuthToken`)
- Modify: `frontend/package.json` (add deps)

**Interfaces:**
- Consumes: `api.getCometAuthToken()` → `{uid, authToken, appId, region}`.
- Produces: `initCometChat()` (idempotent init), `loginCometChat()` (fetch token + login), `getLoggedInUid()`.

- [ ] **Step 1: Install UI Kit + SDK**

Run: `cd frontend && npm install @cometchat/chat-uikit-react@^7 @cometchat/chat-sdk-javascript@^4 dompurify @cometchat/calls-sdk-javascript`
(The calls SDK is required for module resolution even though calling is unused — see Global Constraints.)
Then record the installed versions:
Run: `node -p "[require('@cometchat/chat-uikit-react/package.json').version, require('@cometchat/chat-sdk-javascript/package.json').version]"`
Expected: UI Kit `7.x`, chat SDK `4.x`. If UI Kit major ≠ 7, align the init/login/component API in this task and Tasks 6–8 to that version's docs before continuing.

- [ ] **Step 2: Add api method** — in `frontend/src/api.js`, in the exported api object:

```javascript
  // CometChat: provision current user + fetch a login token.
  getCometAuthToken: () => request('/comet/auth-token', { method: 'POST' }),
```

- [ ] **Step 3: Implement `frontend/src/cometchat.js`** (v7 UI Kit):

```javascript
import { CometChatUIKit, UIKitSettingsBuilder } from '@cometchat/chat-uikit-react';
import { api } from './api';

let inited = false;
let loginPromise = null;

async function initCometChat(appId, region) {
  if (inited) return;
  const settings = new UIKitSettingsBuilder()
    .setAppId(appId)
    .setRegion(region)
    .subscribePresenceForAllUsers()
    .build();
  await CometChatUIKit.init(settings);
  inited = true;
}

/** Idempotent: provisions + logs the current portal user into CometChat. */
export function loginCometChat() {
  if (loginPromise) return loginPromise;
  loginPromise = (async () => {
    const { uid, authToken, appId, region } = await api.getCometAuthToken();
    await initCometChat(appId, region);
    const current = CometChatUIKit.getLoggedInUser();  // v7: capital "In", synchronous
    if (!current || current.getUid() !== uid) {
      await CometChatUIKit.logout().catch(() => {});
      await CometChatUIKit.loginWithAuthToken(authToken);
    }
    return uid;
  })();
  return loginPromise;
}

export async function logoutCometChat() {
  loginPromise = null;
  try { await CometChatUIKit.logout(); } catch { /* ignore */ }
}
```

- [ ] **Step 4: Parse-check**

Run: `cd frontend && ./node_modules/.bin/esbuild src/cometchat.js src/api.js --outfile=/dev/null`
Expected: no errors (external CometChat imports are resolved by Vite at build; esbuild with `--bundle=false` just parses).

If esbuild tries to resolve the imports, instead run a syntax-only check:
Run: `./node_modules/.bin/esbuild src/cometchat.js --outfile=/dev/null --log-level=error` and treat "could not resolve" import errors as acceptable (parse succeeded).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/cometchat.js frontend/src/api.js frontend/package.json frontend/package-lock.json
git commit -m "feat(comet): frontend CometChat init/login helper + api method"
```

---

## Task 6: Admin ChatInbox (UI Kit, role-scoped)

**Files:**
- Create: `frontend/src/screens/Admin/ChatInbox.jsx`
- Modify: `frontend/src/screens/Admin/index.jsx` (swap WhatsAppInbox → ChatInbox)

**Interfaces:**
- Consumes: `loginCometChat()`, `useAuth()` (for role + cities), CometChat UI Kit components.
- Produces: `<ChatInbox />` default export.

- [ ] **Step 1: Implement `frontend/src/screens/Admin/ChatInbox.jsx`:**

```jsx
import { useEffect, useState } from 'react';
import {
  CometChatConversations,
  CometChatMessageHeader,
  CometChatMessageList,
  CometChatMessageComposer,
} from '@cometchat/chat-uikit-react';
import { CometChat } from '@cometchat/chat-sdk-javascript';
import { loginCometChat } from '../../cometchat';
import { useAuth } from '../../contexts/AuthContext';

export default function ChatInbox() {
  const { user } = useAuth();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [peer, setPeer] = useState(null); // CometChat.User of the picked CP

  useEffect(() => {
    let alive = true;
    loginCometChat()
      .then(() => alive && setReady(true))
      .catch((e) => alive && setError(e?.message || 'Chat unavailable'));
    return () => { alive = false; };
  }, []);

  if (error) return <div className="empty-state"><p>{error}</p></div>;
  if (!ready) return <div className="empty-state"><p>Loading chat…</p></div>;

  // admin sees all CP conversations; manager/rm are limited to their cities.
  const cities = user?.cities || (user?.city ? [user.city] : []);
  let conversationsRequestBuilder;
  if (user?.role !== 'admin' && cities.length > 0) {
    conversationsRequestBuilder = new CometChat.ConversationsRequestBuilder()
      .setLimit(50)
      .withTags(true)
      .setTags(cities.map((c) => `city:${c}`));
  }

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 160px)' }}>
      <div style={{ width: 320, borderRight: '1px solid var(--oh-border)' }}>
        <CometChatConversations
          {...(conversationsRequestBuilder ? { conversationsRequestBuilder } : {})}
          onItemClick={(conv) => setPeer(conv?.getConversationWith?.())}
        />
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {peer ? (
          <>
            <CometChatMessageHeader user={peer} />
            <CometChatMessageList user={peer} />
            <CometChatMessageComposer user={peer} />
          </>
        ) : (
          <div className="empty-state"><p>Select a conversation</p></div>
        )}
      </div>
    </div>
  );
}
```

Note (validate against v7 docs in Task 5): v7 has no `CometChatConversationsWithMessages` composite — compose the list + message pane as above. The selection callback on `CometChatConversations` is `onItemClick(conversation)`; the picked peer is `conversation.getConversationWith()` (a `CometChat.User` or `CometChat.Group`). Tag filtering: `ConversationsRequestBuilder().withTags(true).setTags([...])`.

- [ ] **Step 2: Swap in `index.jsx`** — replace the `WhatsAppInbox` import and its render usage with `ChatInbox`. Find:

```jsx
import WhatsAppInbox from './WhatsAppInbox';
```
Replace with:
```jsx
import ChatInbox from './ChatInbox';
```
Then replace the `<WhatsAppInbox .../>` render (the `whatsappInboxOpen` modal/section) with `<ChatInbox />`, keeping the same open/close toggle wiring.

- [ ] **Step 3: Parse-check**

Run: `cd frontend && ./node_modules/.bin/esbuild src/screens/Admin/ChatInbox.jsx --outfile=/dev/null --log-level=error` (import-resolution errors acceptable; syntax must pass).

- [ ] **Step 4: Manual verification** (env set, both DBs up):
Admin opens the inbox → sees all CP conversations; a manager account → sees only their cities' CPs; sending a reply appears on the CP side in real time.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screens/Admin/ChatInbox.jsx frontend/src/screens/Admin/index.jsx
git commit -m "feat(comet): admin ChatInbox (UI Kit, role-scoped)"
```

---

## Task 7: CP-side chat widget

**Files:**
- Modify: `frontend/src/screens/Dashboard.jsx` (add chat entry point + view)
- Create: `frontend/src/screens/CpChat.jsx`

**Interfaces:**
- Consumes: `loginCometChat()`, CometChat UI Kit message components, `VITE_COMET_*` via the token endpoint.
- Produces: `<CpChat />` — the CP↔openhouse conversation.

- [ ] **Step 1: Implement `frontend/src/screens/CpChat.jsx`:**

```jsx
import { useEffect, useState } from 'react';
import {
  CometChatMessageHeader, CometChatMessageList, CometChatMessageComposer,
} from '@cometchat/chat-uikit-react';
import { CometChat } from '@cometchat/chat-sdk-javascript';
import { loginCometChat } from '../cometchat';

const STAFF_UID = 'openhouse';

export default function CpChat() {
  const [state, setState] = useState({ ready: false, error: '', peer: null });

  useEffect(() => {
    let alive = true;
    loginCometChat()
      .then(() => CometChat.getUser(STAFF_UID))
      .then((peer) => alive && setState({ ready: true, error: '', peer }))
      .catch((e) => alive && setState({ ready: false, error: e?.message || 'Chat unavailable', peer: null }));
    return () => { alive = false; };
  }, []);

  if (state.error) return <div className="empty-state"><p>{state.error}</p></div>;
  if (!state.ready) return <div className="empty-state"><p>Loading chat…</p></div>;
  return (
    <div style={{ height: 'calc(100vh - 140px)', display: 'flex', flexDirection: 'column' }}>
      <CometChatMessageHeader user={state.peer} />
      <CometChatMessageList user={state.peer} />
      <CometChatMessageComposer user={state.peer} />
    </div>
  );
}
```

Note: v7 has no `CometChatMessages` composite — compose header+list+composer (above). `user`/`group` props are mutually exclusive.

- [ ] **Step 2: Add entry point in `Dashboard.jsx`** — add a "Chat with Openhouse" button/tab that renders `<CpChat />` (mirror how existing screens toggle a view; keep it behind the CP's normal auth). Import:

```jsx
import CpChat from './CpChat';
```

- [ ] **Step 3: Parse-check**

Run: `cd frontend && ./node_modules/.bin/esbuild src/screens/CpChat.jsx --outfile=/dev/null --log-level=error` (import-resolution acceptable).

- [ ] **Step 4: Manual verification:** CP opens chat → sees conversation with Openhouse; message sent appears in the admin inbox in real time; the CometChat webhook writes a `chat_messages` row (`direction='inbound'`) + a `cp_chat_reply` activity-log entry.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screens/CpChat.jsx frontend/src/screens/Dashboard.jsx
git commit -m "feat(comet): CP-side chat widget"
```

---

## Task 8: DetailPanel per-CP thread swap

**Files:**
- Modify: `frontend/src/screens/Admin/DetailPanel.jsx` (replace `WhatsAppThread`)

**Interfaces:**
- Consumes: `loginCometChat()`, submission's `cp_id`, CometChat UI Kit message view.
- Produces: in-context CP↔openhouse thread for the submission's CP.

- [ ] **Step 1: Create a small inline component** in `DetailPanel.jsx` (or a sibling `CpThread.jsx`) that logs into CometChat (as openhouse), resolves `CometChat.getUser('cp_' + s.cp_id)`, and renders the composed `CometChatMessageHeader`/`CometChatMessageList`/`CometChatMessageComposer` (v7). Replace the existing WhatsApp block:

Find (around line 958–965):
```jsx
import WhatsAppThread from './WhatsAppThread';
...
<WhatsAppThread submissionId={s.id} hideEmpty={false} canSend={isStaff} autoScroll={false} />
```
Replace the import with the new component and render it with `cpId={s.cp_id}`.

```jsx
// CpThread.jsx
import { useEffect, useState } from 'react';
import {
  CometChatMessageHeader, CometChatMessageList, CometChatMessageComposer,
} from '@cometchat/chat-uikit-react';
import { CometChat } from '@cometchat/chat-sdk-javascript';
import { loginCometChat } from '../../cometchat';

export default function CpThread({ cpId }) {
  const [peer, setPeer] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!cpId) return;
    loginCometChat()
      .then(() => CometChat.getUser(`cp_${cpId}`))
      .then((u) => alive && setPeer(u))
      .catch(() => {});
    return () => { alive = false; };
  }, [cpId]);
  if (!peer) return <div style={{ fontSize: 12, color: '#999' }}>Loading chat…</div>;
  return (
    <div style={{ height: 360, display: 'flex', flexDirection: 'column' }}>
      <CometChatMessageHeader user={peer} />
      <CometChatMessageList user={peer} />
      <CometChatMessageComposer user={peer} />
    </div>
  );
}
```

- [ ] **Step 2: Parse-check**

Run: `cd frontend && ./node_modules/.bin/esbuild src/screens/Admin/DetailPanel.jsx src/screens/Admin/CpThread.jsx --outfile=/dev/null --log-level=error` (import-resolution acceptable).

- [ ] **Step 3: Manual verification:** open a submission's detail panel → the CP's chat thread renders; replies sync with the main inbox.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/screens/Admin/DetailPanel.jsx frontend/src/screens/Admin/CpThread.jsx
git commit -m "feat(comet): per-submission CP thread via CometChat"
```

---

## Task 9: Interakt teardown

**Files:**
- Modify: `backend/routes/admin.py` (remove `/whatsapp/*` endpoints ~lines 4962–5270)
- Modify: `backend/routes/webhooks.py` (remove Interakt handler + helpers)
- Delete: `backend/services_whatsapp.py`
- Modify: `backend/config.py` (remove `INTERAKT_*`, `WA_*`)
- Modify: `frontend/src/api.js` (remove `adminListWhatsAppThreads`, `adminGetWhatsAppThread`, send/thread methods)
- Delete: `frontend/src/screens/Admin/WhatsAppInbox.jsx`, `frontend/src/screens/Admin/WhatsAppThread.jsx`

**Interfaces:**
- Consumes: nothing new. Removes dead Interakt surface now that CometChat is live.

- [ ] **Step 1: Grep for all references first**

Run: `grep -rnE "services_whatsapp|WhatsAppThread|WhatsAppInbox|adminListWhatsAppThreads|adminGetWhatsAppThread|INTERAKT|WA_ENABLED|WA_DEFAULT|send_template|send_text" backend frontend/src | grep -v venv`
Expected: only the files listed above (plus the disabled reminders cron, which imports `send_template` — see Step 2).

- [ ] **Step 2: Handle the reminders cron import** — `routes/cron.py` imports `from services_whatsapp import send_template`. Since the cron is disabled and out of scope, do the minimal safe thing: leave the cron file but guard the import so deleting `services_whatsapp.py` doesn't break app import. Change its top-level import to a lazy import inside `send_cp_reminders` after the `WA_ENABLED`/disabled short-circuit, OR keep a stub. Chosen approach — replace the module-level import with a lazy one *below* the disabled-return, so it's never reached:

Verify the short-circuit returns before any `send_template` call, then move `from services_whatsapp import send_template` to just above its first use. If `services_whatsapp.py` is deleted, add a 3-line stub `backend/services_whatsapp.py` raising `RuntimeError("WhatsApp retired")` if called — safest given the cron is dead code. Decide during execution; document which you did in the commit.

- [ ] **Step 3: Remove backend Interakt endpoints/config/service** per the Files list. Byte-compile:

Run: `./backend/venv/bin/python -m py_compile backend/routes/admin.py backend/routes/webhooks.py backend/config.py backend/app.py`
Expected: no output.

- [ ] **Step 4: Remove frontend WhatsApp UI + api methods**, delete the two files, and remove any remaining imports.

Run: `grep -rnE "WhatsApp|whatsapp|Interakt|interakt" frontend/src | grep -viE "styles\.js"` → expected: no functional references remain (styles constant, if unused, may also be removed).

- [ ] **Step 5: Parse-check frontend**

Run: `cd frontend && for f in src/api.js src/screens/Admin/index.jsx src/screens/Admin/DetailPanel.jsx; do ./node_modules/.bin/esbuild "$f" --outfile=/dev/null --log-level=error; done`
Expected: syntax OK.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(comet): retire Interakt WhatsApp integration (keep whatsapp_messages table)"
```

---

## Post-implementation checklist (manual, requires prod env + keys)

- [ ] Run `backend/migrations/2026-07-09-chat-messages.sql` in Neon.
- [ ] Set backend `COMET_APP_ID`, `COMET_REGION`, `COMET_REST_API_KEY`, `COMET_AUTH_KEY`, `COMET_WEBHOOK_USER`, `COMET_WEBHOOK_PASS` + frontend `VITE_COMET_APP_ID`, `VITE_COMET_REGION`.
- [ ] In the CometChat dashboard, create the `openhouse` user and configure the **message webhook** (trigger `message_sent`) → `POST /api/webhooks/cometchat` with **Basic Auth** (`useBasicAuth: true`, username `COMET_WEBHOOK_USER`, password `COMET_WEBHOOK_PASS`) — NOT Bearer.
- [ ] Confirm CometChat plan: Build is **dev/testing only** (100-user cap). Production with ~3000 CPs needs a paid tier sized for the CP count.
- [ ] End-to-end: CP sends → admin inbox receives (real time) + `chat_messages` row + `cp_chat` activity entry; admin replies → CP receives; manager scoping verified.
