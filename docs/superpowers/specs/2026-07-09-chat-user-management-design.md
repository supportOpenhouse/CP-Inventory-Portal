# Chat User Management — Design

**Date:** 2026-07-09
**Status:** Approved (pending spec review)
**Goal:** Make CP chat **admin-gated**: a CP can chat only after an admin enables them. Add an admin-only management panel (in the Chat Inbox) to enable/disable CP chat access and see CP "start chat" requests. Builds on the CometChat migration.

## Model change

- Today `/comet/auth-token` auto-creates a CP's CometChat user on first login. **Change:** a CP can chat only if an admin has *enabled* their access.
- The CometChat user is created once and **never deleted**. Enable/disable toggles token access only, so the conversation history always survives — disabling then re-enabling resurfaces the old thread for both sides.
- Access to all management actions is **admin-only** (role `admin`; managers/RMs excluded), matching the broadcast feature.

## Data (two new tables)

```sql
-- Whether a CP is allowed to chat. Absence of a row (or enabled=false) = not enabled.
CREATE TABLE IF NOT EXISTS cp_chat_access (
    cp_id       INTEGER PRIMARY KEY REFERENCES channel_partners(id),
    enabled     BOOLEAN NOT NULL DEFAULT FALSE,
    enabled_by  INTEGER,          -- admin actor id (nullable)
    enabled_at  TIMESTAMPTZ,
    disabled_at TIMESTAMPTZ,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CP "start chat" requests. One PENDING request per CP (partial unique index).
CREATE TABLE IF NOT EXISTS chat_requests (
    id           SERIAL PRIMARY KEY,
    cp_id        INTEGER NOT NULL REFERENCES channel_partners(id),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at  TIMESTAMPTZ,
    resolved_by  INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_requests_pending
    ON chat_requests(cp_id) WHERE resolved_at IS NULL;
```

"Enabled" = a `cp_chat_access` row with `enabled = TRUE`.

## Backend (routes/comet.py + services_cometchat.py)

- **`POST /comet/auth-token` (CP)** — changed: for a CP caller, if not enabled → `403 {"error":"chat_not_enabled"}`. If enabled → `ensure_user` + issue token as today. (Staff/`openhouse` unchanged — always allowed.)
- **`POST /comet/request-chat` (CP)** — insert a pending `chat_requests` row for `g.user.cp_id` (idempotent: the partial unique index makes a duplicate pending request a no-op / `ON CONFLICT DO NOTHING`). Returns `{ok:true}`.
- **`GET /comet/requests` (admin)** — list pending requests joined to `channel_partners`: `[{cp_id, name, phone, city, requested_at}]`.
- **`GET /comet/access?cp_ids=1,2,3` (admin)** — returns `{"enabled":[ids…]}`, the subset of the given CP ids currently enabled. Used by the manage panel to show status.
- **`POST /comet/enable` (admin)** — body `{cp_id}`: `ensure_user(cp)` + upsert `cp_chat_access` (enabled=true, enabled_by, enabled_at) + resolve any pending `chat_requests` for that CP. Returns `{ok:true, uid}`.
- **`POST /comet/disable` (admin)** — body `{cp_id}`: revoke tokens via `services_cometchat.revoke_auth_tokens(uid)` (CometChat `DELETE /v3/users/{uid}/auth_tokens`) + set `cp_chat_access.enabled=false, disabled_at=now()`. User + history kept. Returns `{ok:true}`.
- **`POST /comet/broadcast` (admin)** — augment: enable each recipient (upsert `cp_chat_access` enabled=true) in addition to `ensure_user` + send, so recipients can reply.
- **New `services_cometchat.revoke_auth_tokens(uid) -> bool`** — `DELETE {base}/users/{uid}/auth_tokens` (best-effort).
- Helper `_cp_enabled(cur, cp_id) -> bool` and `_set_enabled(cur, cp_id, enabled, actor_id)` for the access table.
- All admin endpoints reject non-admins with 403 (reuse the `g.user.role != "admin"` check already used by broadcast).

## Frontend

- **CP side (`CpChat.jsx`)** — the login flow already goes through `loginCometChat()` → `/comet/auth-token`. On a `chat_not_enabled` 403, render *"Admin has not created chat account for you"* + a **"Request admin to start chat"** button. The button calls `api.cometRequestChat()` → on success show "Request sent — an admin will enable your chat." (Distinguish this state from the generic "Chat unavailable" error.)
- **Manage panel (in `ChatInbox.jsx`, admin-only)** — a `ChatUserManager` modal/view opened from a button in the inbox topbar (next to 📢), with two sections:
  - **Requests** — `GET /comet/requests`; each row shows CP name/phone/city + time, with an **Enable & start chat** button (`POST /comet/enable`, then refresh; the CP disappears from requests).
  - **Manage CPs** — a search (reuses `adminCpSearch`) that shows each CP with their current enabled state and an **Enable** / **Disable** toggle (`/comet/enable` / `/comet/disable`). Current state comes from a dedicated lookup: **`GET /comet/access?cp_ids=1,2,3` (admin)** → `{"enabled":[1,3]}` (the subset of the given ids that are enabled). The panel calls it with the current search result ids after each search.
- `api.js`: add `cometRequestChat()`, `cometListRequests()`, `cometEnableCp(cpId)`, `cometDisableCp(cpId)`, `cometAccessStatus(cpIds)`.

## Data flow

- CP opens chat → token 403 `chat_not_enabled` → CP sees message + Request button → `chat_requests` pending row.
- Admin opens Chat Inbox → Manage → sees the request → **Enable & start chat** → `ensure_user` + access enabled + request resolved.
- CP re-opens chat → token issued → chats; their conversation appears in the admin inbox.
- Admin **Disable** → tokens revoked + access off → CP's next open shows the request state again; history retained for when re-enabled.

## Error handling / edge cases

- Duplicate pending request → partial unique index → `ON CONFLICT DO NOTHING` (single pending row).
- Enable when already enabled → idempotent upsert (no error).
- Disable when CometChat user doesn't exist yet → revoke call best-effort (ignore 404); still set access off.
- `chat_not_enabled` must be distinguishable client-side: the endpoint returns a stable `error` code string the frontend checks (not just a message).
- Build 100-user cap: revoke-tokens keeps the user (slot not freed); enabling >100 distinct CPs needs a paid tier — surface the CometChat error if enable fails.

## Testing

- Backend standalone asserts (no pytest): `chat_not_enabled` gate logic (enabled vs not), request dedup (second pending insert is a no-op), enable resolves pending request. Manual: CP request → admin enable → CP chats → admin disable → CP blocked → re-enable → old messages return.

## Trade-offs / non-goals

- Revoke-tokens keeps the CometChat user (history preserved, but Build user slot not freed). Full-delete was rejected to preserve history.
- No CP notification when enabled (they just retry). Push/notify is out of scope.
- Managers/RMs get no management actions (admin-only), consistent with broadcast.
