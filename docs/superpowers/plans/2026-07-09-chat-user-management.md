# Chat User Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Admin-gate CP chat — a CP can chat only after an admin enables them — plus a CP "request chat" flow and an admin-only management panel (enable/disable + requests) in the Chat Inbox.

**Architecture:** New `cp_chat_access` (enabled flag per CP) + `chat_requests` tables. `/comet/auth-token` gates CP callers on `enabled`. Admin endpoints enable (ensure_user + flag + resolve request), disable (revoke CometChat tokens + flag). CP side shows a request button on the gate; admin panel lists requests + toggles access.

**Tech Stack:** Python/Flask + psycopg2, React + Vite, CometChat REST, Postgres (Neon).

## Global Constraints

- **NO git commits** (working tree only, on `main`). Skip every "Commit" step.
- Admin-only for all management endpoints/UI: reject non-admin with `403` via `g.user.get("role") != "admin"` (same check the broadcast endpoint uses in `routes/comet.py`).
- No pytest harness — "tests" are standalone `assert` scripts run with `./backend/venv/bin/python`.
- DB access pattern: `get_app_conn()` / `put_app_conn()`, `RealDictCursor` rows (`row["col"]`).
- CometChat REST base: `https://{APP_ID}.api-{REGION}.cometchat.io/v3`, header `apikey: {COMET_REST_API_KEY}`; CP uid = `cp_<id>`.
- Frontend UI-Kit v7; the CP chat login path is `loginCometChat()` → `api.getCometAuthToken()`.
- The `chat_not_enabled` gate MUST be a stable machine-readable `error` code string in the JSON body (not just a message), so the frontend can branch on it.
- Existing `routes/comet.py` already has: `auth_token`, `ensure_user_route`, `broadcast`, `_cp_name_city`, `_BROADCAST_MAX`, imports of `get_app_conn/put_app_conn`, `log_activity`, `Config`, `require_auth`, `services_cometchat as comet`.

---

## File structure
- Create `backend/migrations/2026-07-09-chat-user-management.sql`
- Modify `backend/services_cometchat.py` — add `revoke_auth_tokens(uid)`
- Modify `backend/routes/comet.py` — gate `auth_token`; add `request-chat`, `requests`, `access`, `enable`, `disable`; augment `broadcast`
- Modify `frontend/src/api.js` — add 5 methods
- Modify `frontend/src/screens/CpChat.jsx` — request-chat state on the gate
- Create `frontend/src/screens/Admin/ChatUserManager.jsx`
- Modify `frontend/src/screens/Admin/ChatInbox.jsx` — button + modal (admin-only)

---

## Task 1: Migration — cp_chat_access + chat_requests

**Files:** Create `backend/migrations/2026-07-09-chat-user-management.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Admin-gated CP chat. cp_chat_access = who may chat; chat_requests = CP asks.
CREATE TABLE IF NOT EXISTS cp_chat_access (
    cp_id       INTEGER PRIMARY KEY REFERENCES channel_partners(id),
    enabled     BOOLEAN NOT NULL DEFAULT FALSE,
    enabled_by  INTEGER,
    enabled_at  TIMESTAMPTZ,
    disabled_at TIMESTAMPTZ,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_requests (
    id           SERIAL PRIMARY KEY,
    cp_id        INTEGER NOT NULL REFERENCES channel_partners(id),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at  TIMESTAMPTZ,
    resolved_by  INTEGER
);
-- At most one PENDING (unresolved) request per CP.
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_requests_pending
    ON chat_requests(cp_id) WHERE resolved_at IS NULL;
```

- [ ] **Step 2:** This is prod DDL — the user runs it in Neon. Do NOT auto-run. Verification (implementer performs, by reading): the SQL matches the spec's DDL.

---

## Task 2: `services_cometchat.revoke_auth_tokens`

**Files:** Modify `backend/services_cometchat.py`

**Interfaces:** Produces `revoke_auth_tokens(uid: str) -> bool`.

- [ ] **Step 1: Add the function** (place next to `issue_auth_token`):

```python
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
```

Note: `DELETE /v3/users/{uid}/auth_tokens` (revoke-all) is the CometChat REST shape used here; if the live API differs (e.g. requires a token id), adjust to the documented "delete all auth tokens for a user" call. The DB gate (Task 4) is the primary block; this is the immediate-cutoff enhancement, so a revoke failure is logged, not fatal.

- [ ] **Step 2:** `./backend/venv/bin/python -m py_compile backend/services_cometchat.py` → no output.

---

## Task 3: Gate auth-token + request-chat endpoint

**Files:** Modify `backend/routes/comet.py`; Test `backend/tests_chat_access.py`

**Interfaces:** Produces helper `_cp_enabled(cur, cp_id) -> bool`; gated `auth_token`; `POST /comet/request-chat`.

- [ ] **Step 1: Write the failing test** — `backend/tests_chat_access.py`:

```python
import sys; sys.path.insert(0, "backend")
from routes.comet import _resolve_error_code
# The gate returns a stable code the frontend branches on.
assert _resolve_error_code("chat_not_enabled") == "chat_not_enabled"
print("PASS")
```

(The real gate needs a DB + request context; this asserts the stable error-code constant exists. Manual verification covers the DB path.)

- [ ] **Step 2: Run it** — `./backend/venv/bin/python backend/tests_chat_access.py` → `ImportError` (function missing).

- [ ] **Step 3: Add the access helper + error code + gate `auth_token`.** Add near the top of `routes/comet.py` (after `_BROADCAST_MAX`):

```python
CHAT_NOT_ENABLED = "chat_not_enabled"


def _resolve_error_code(code):
    """Identity passthrough for the stable client-facing error codes (kept as a
    function so tests can assert the code exists without a request context)."""
    return code


def _cp_enabled(cur, cp_id) -> bool:
    cur.execute("SELECT enabled FROM cp_chat_access WHERE cp_id = %s", (cp_id,))
    row = cur.fetchone()
    return bool(row and row["enabled"])
```

Then modify `auth_token`: for a CP caller (uid != staff), check enablement BEFORE ensure_user/token. Replace the CP branch so it reads:

```python
    if uid == Config.COMET_STAFF_UID:
        name, city = "Openhouse", None
    else:
        cp_id = user.get("cp_id")
        conn = get_app_conn()
        try:
            with conn.cursor() as cur:
                if not _cp_enabled(cur, cp_id):
                    return jsonify({"error": CHAT_NOT_ENABLED,
                                    "message": "Admin has not created chat account for you"}), 403
        finally:
            put_app_conn(conn)
        name, city = _cp_name_city(cp_id)
        name = name or user.get("phone") or uid
        if city is None:
            city = user.get("city")

    comet.ensure_user(uid, name, city)
```

- [ ] **Step 4: Add `POST /comet/request-chat`** (CP records a pending request):

```python
@bp.post("/request-chat")
@require_auth
def request_chat():
    """CP asks an admin to enable their chat. Idempotent (one pending per CP)."""
    cp_id = g.user.get("cp_id")
    if g.user.get("role", "cp") != "cp" or not cp_id:
        return jsonify({"error": "Only CPs can request chat"}), 400
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            # Partial unique index (cp_id WHERE resolved_at IS NULL) makes a
            # duplicate pending request a no-op.
            cur.execute(
                "INSERT INTO chat_requests (cp_id) VALUES (%s) "
                "ON CONFLICT (cp_id) WHERE resolved_at IS NULL DO NOTHING",
                (cp_id,),
            )
            conn.commit()
    finally:
        put_app_conn(conn)
    return jsonify({"ok": True}), 200
```

Note: verify Postgres accepts `ON CONFLICT (cp_id) WHERE resolved_at IS NULL` targeting the partial index; if the parser rejects the inline predicate, use `ON CONFLICT ON CONSTRAINT uq_chat_requests_pending DO NOTHING` (a partial unique index can be named as the conflict target) — confirm and use whichever the DB accepts.

- [ ] **Step 5: Run test** → `./backend/venv/bin/python backend/tests_chat_access.py` → `PASS`. Then `./backend/venv/bin/python -m py_compile backend/routes/comet.py`.

---

## Task 4: Admin endpoints — requests, access, enable, disable + broadcast enable

**Files:** Modify `backend/routes/comet.py`

**Interfaces:** Consumes `_cp_enabled`, `_cp_name_city`, `comet.ensure_user`, `comet.revoke_auth_tokens`. Produces `GET /comet/requests`, `GET /comet/access`, `POST /comet/enable`, `POST /comet/disable`.

- [ ] **Step 1: Add an admin guard helper + the four endpoints.** Append to `routes/comet.py`:

```python
def _require_admin():
    return g.user.get("role", "cp") == "admin"


def _set_access(cur, cp_id, enabled, actor_id):
    """Upsert cp_chat_access; stamp enabled_by/enabled_at or disabled_at."""
    if enabled:
        cur.execute(
            """
            INSERT INTO cp_chat_access (cp_id, enabled, enabled_by, enabled_at, updated_at)
            VALUES (%s, TRUE, %s, NOW(), NOW())
            ON CONFLICT (cp_id) DO UPDATE
                SET enabled = TRUE, enabled_by = EXCLUDED.enabled_by,
                    enabled_at = NOW(), updated_at = NOW()
            """,
            (cp_id, actor_id),
        )
    else:
        cur.execute(
            """
            INSERT INTO cp_chat_access (cp_id, enabled, disabled_at, updated_at)
            VALUES (%s, FALSE, NOW(), NOW())
            ON CONFLICT (cp_id) DO UPDATE
                SET enabled = FALSE, disabled_at = NOW(), updated_at = NOW()
            """,
            (cp_id,),
        )


@bp.get("/requests")
@require_auth
def list_requests():
    if not _require_admin():
        return jsonify({"error": "Admin only"}), 403
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT r.cp_id, r.requested_at, cp.name, cp.phone, cp.city
                FROM chat_requests r JOIN channel_partners cp ON cp.id = r.cp_id
                WHERE r.resolved_at IS NULL
                ORDER BY r.requested_at ASC LIMIT 200
                """
            )
            rows = cur.fetchall()
    finally:
        put_app_conn(conn)
    return jsonify({"requests": rows}), 200


@bp.get("/access")
@require_auth
def access_status():
    if not _require_admin():
        return jsonify({"error": "Admin only"}), 403
    raw = (request.args.get("cp_ids") or "").strip()
    ids = [int(x) for x in raw.split(",") if x.strip().isdigit()]
    if not ids:
        return jsonify({"enabled": []}), 200
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT cp_id FROM cp_chat_access WHERE enabled = TRUE AND cp_id = ANY(%s)",
                (ids,),
            )
            enabled = [r["cp_id"] for r in cur.fetchall()]
    finally:
        put_app_conn(conn)
    return jsonify({"enabled": enabled}), 200


@bp.post("/enable")
@require_auth
def enable_cp():
    if not _require_admin():
        return jsonify({"error": "Admin only"}), 403
    if not comet.configured():
        return jsonify({"error": "Chat is not configured."}), 503
    cp_id = (request.get_json(silent=True) or {}).get("cp_id")
    if not isinstance(cp_id, int):
        return jsonify({"error": "cp_id is required"}), 400
    name, city = _cp_name_city(cp_id)
    if not name:
        return jsonify({"error": "CP not found"}), 404
    comet.ensure_user(f"cp_{cp_id}", name, city)
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            _set_access(cur, cp_id, True, g.user.get("cp_id"))
            cur.execute(
                "UPDATE chat_requests SET resolved_at = NOW(), resolved_by = %s "
                "WHERE cp_id = %s AND resolved_at IS NULL",
                (g.user.get("cp_id"), cp_id),
            )
            log_activity(cur, action="chat_enable", category="chat",
                         entity_type="cp", entity_id=cp_id, details={"cp_id": cp_id})
            conn.commit()
    finally:
        put_app_conn(conn)
    return jsonify({"ok": True, "uid": f"cp_{cp_id}"}), 200


@bp.post("/disable")
@require_auth
def disable_cp():
    if not _require_admin():
        return jsonify({"error": "Admin only"}), 403
    cp_id = (request.get_json(silent=True) or {}).get("cp_id")
    if not isinstance(cp_id, int):
        return jsonify({"error": "cp_id is required"}), 400
    comet.revoke_auth_tokens(f"cp_{cp_id}")  # best-effort immediate cutoff
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            _set_access(cur, cp_id, False, g.user.get("cp_id"))
            log_activity(cur, action="chat_disable", category="chat",
                         entity_type="cp", entity_id=cp_id, details={"cp_id": cp_id})
            conn.commit()
    finally:
        put_app_conn(conn)
    return jsonify({"ok": True}), 200
```

- [ ] **Step 2: Augment `broadcast`** so recipients get enabled (they can reply). In the `broadcast` fan-out loop, after `comet.ensure_user(...)`, add access enable. Change the loop body to:

```python
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            sent = 0
            for cp in targets:
                uid = f"cp_{cp['id']}"
                comet.ensure_user(uid, cp.get("name") or cp.get("phone") or uid, cp.get("city"))
                _set_access(cur, cp["id"], True, g.user.get("cp_id"))
                if comet.send_text_message(Config.COMET_STAFF_UID, uid, message):
                    sent += 1
            conn.commit()
    finally:
        put_app_conn(conn)
    failed = len(targets) - sent
```

(Replace the existing send loop + its separate activity-log block; keep a single `log_activity(cur, action="admin_broadcast", …)` inside this same cursor before commit, matching the current details dict.)

- [ ] **Step 3: Verify** — `./backend/venv/bin/python -m py_compile backend/routes/comet.py` and `./backend/venv/bin/python -c "import sys; sys.path.insert(0,'backend'); import app"` → both clean.

- [ ] **Step 4: Manual** (needs prod env + migration run): as admin, `GET /api/comet/requests` returns `{requests:[]}`; `POST /api/comet/enable {cp_id:143}` → 200; `GET /api/comet/access?cp_ids=143` → `{enabled:[143]}`; `POST /api/comet/disable {cp_id:143}` → 200; `GET .../access?cp_ids=143` → `{enabled:[]}`.

---

## Task 5: Frontend — api methods + CpChat request flow

**Files:** Modify `frontend/src/api.js`, `frontend/src/screens/CpChat.jsx`

- [ ] **Step 1: Add api methods** to the `api` object in `frontend/src/api.js` (near `cometBroadcast`):

```javascript
  cometRequestChat: () => request('/comet/request-chat', { method: 'POST' }),
  cometListRequests: () => request('/comet/requests'),
  cometAccessStatus: (cpIds) => request(`/comet/access?cp_ids=${cpIds.join(',')}`),
  cometEnableCp: (cpId) => request('/comet/enable', { method: 'POST', body: { cp_id: cpId } }),
  cometDisableCp: (cpId) => request('/comet/disable', { method: 'POST', body: { cp_id: cpId } }),
```

- [ ] **Step 2: CpChat gate handling.** In `frontend/src/screens/CpChat.jsx`, the `loginCometChat()` rejection carries the backend error. Detect the `chat_not_enabled` code (the `ApiError.data.error` from `api.js`'s thrown error) and show the request UI instead of the generic error.

Replace the effect's catch + the error render. The effect:

```jsx
  const [requested, setRequested] = useState(false);
  const [reqBusy, setReqBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    loginCometChat()
      .then(() => CometChat.getUser(STAFF_UID))
      .then((peer) => alive && setState({ ready: true, error: '', peer, notEnabled: false }))
      .catch((e) => {
        if (!alive) return;
        const notEnabled = e?.status === 403 && e?.data?.error === 'chat_not_enabled';
        setState({
          ready: false,
          error: notEnabled ? '' : (e?.message || 'Chat unavailable'),
          peer: null,
          notEnabled,
        });
      });
    return () => { alive = false; };
  }, []);
```

(Initialise state with `notEnabled: false`.) Add a handler + the not-enabled render branch (before the generic error branch):

```jsx
  const handleRequest = async () => {
    setReqBusy(true);
    try { await api.cometRequestChat(); setRequested(true); }
    catch { /* ignore — button just won't confirm */ }
    finally { setReqBusy(false); }
  };
```

```jsx
      {state.notEnabled ? (
        <div className="empty-state">
          <p>Admin has not created chat account for you.</p>
          {requested ? (
            <p style={{ color: '#166534' }}>Request sent — an admin will enable your chat.</p>
          ) : (
            <button className="primary-btn" onClick={handleRequest} disabled={reqBusy}>
              {reqBusy ? 'Sending…' : 'Request admin to start chat'}
            </button>
          )}
        </div>
      ) : state.error ? (
        <div className="empty-state"><p>{state.error}</p></div>
      ) : !state.ready ? (
        <div className="empty-state"><p>Loading chat…</p></div>
      ) : (
        /* existing ChatErrorBoundary + CometChatProvider message pane */
      )}
```

Requires `import { api } from '../api';` (add if not present).

- [ ] **Step 3: Parse-check** — `cd frontend && for f in src/api.js src/screens/CpChat.jsx; do ./node_modules/.bin/esbuild "$f" --outfile=/dev/null --log-level=error; done` (import-resolution errors for `@cometchat/*` acceptable).

- [ ] **Step 4: Verify `ApiError` carries `status` + `data`.** Read `frontend/src/api.js` `ApiError` — it already stores `this.status` and `this.data` (from the migration). Confirm the 403 body `{error:"chat_not_enabled"}` lands in `e.data.error`.

---

## Task 6: Admin ChatUserManager panel (in Chat Inbox)

**Files:** Create `frontend/src/screens/Admin/ChatUserManager.jsx`; Modify `frontend/src/screens/Admin/ChatInbox.jsx`

- [ ] **Step 1: Create `ChatUserManager.jsx`** — an admin modal (mirror `BroadcastModal.jsx`'s overlay/header/body/footer shell + inline styles). Two sections:
  - **Requests:** on mount call `api.cometListRequests()` → render each `{cp_id, name, phone, city, requested_at}` with an **Enable & start chat** button → `api.cometEnableCp(cp_id)` → on success remove it from the list.
  - **Manage CPs:** a debounced search (`useDebouncedValue`, min 2 chars) using `api.adminCpSearch(q, 20, '')`; after results arrive, call `api.cometAccessStatus(results.map(r=>r.id))` to get the enabled set; render each CP with its state and an **Enable**/**Disable** button (`cometEnableCp`/`cometDisableCp`) that flips the local state on success.
  - Props: `onClose`.

Follow BroadcastModal for structure; keep it functional, not over-designed. Full code is the implementer's to write from this spec + the BroadcastModal reference (transcription-level from an existing sibling).

- [ ] **Step 2: Wire into `ChatInbox.jsx`** (admin-only): import `ChatUserManager`; add `const [manageOpen, setManageOpen] = useState(false);`; add a 👥 button in the topbar inside the existing `{isAdmin && (<div className="admin-topbar-right">…)}` block (next to 📢) with `onClick={() => setManageOpen(true)}` and `title="Manage chat users"`; render `{manageOpen && <ChatUserManager onClose={() => setManageOpen(false)} />}` next to the BroadcastModal render.

- [ ] **Step 3: Parse-check** — `cd frontend && for f in src/screens/Admin/ChatUserManager.jsx src/screens/Admin/ChatInbox.jsx; do ./node_modules/.bin/esbuild "$f" --outfile=/dev/null --log-level=error; done`.

- [ ] **Step 4: Manual** — as admin open Chat Inbox → 👥 → see requests + search/enable/disable. As a CP (with access off) open chat → "Admin has not created chat account…" + Request button → request appears in the admin panel → Enable → CP can chat.

---

## Post-implementation checklist (user)
- [ ] Run `backend/migrations/2026-07-09-chat-user-management.sql` in Neon.
- [ ] Existing enabled CPs: after this lands, CPs default to NOT enabled (no `cp_chat_access` row). To keep the current testers chatting, enable them via the panel (or a one-off `INSERT INTO cp_chat_access (cp_id, enabled, enabled_at) VALUES (…, TRUE, NOW())`).
- [ ] Verify the CometChat `DELETE .../auth_tokens` revoke shape against live (Task 2 note).
