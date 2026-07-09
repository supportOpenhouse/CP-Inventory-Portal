# CometChat Migration — Design

**Date:** 2026-07-09
**Status:** Approved (pending spec review)
**Goal:** Replace the WhatsApp (Interakt) two-way messaging with CometChat in-app chat.

## Scope

**In scope**
- Two-way admin↔CP messaging (the WhatsApp Inbox + per-submission thread).
- Inbound CP replies (real-time via CometChat instead of the Interakt webhook).

**Out of scope**
- Automated CP reminders (`cp_visit_reminder` / `cp_sellermeeting_reminder`). Already
  disabled in `routes/cron.py`; left untouched. CometChat cannot reach a CP on their
  phone's WhatsApp, so proactive out-of-app reminders are not part of this migration.

## Chat model

- Every CP is a CometChat user with uid `cp_<id>`, tagged with their `city`.
- One shared CometChat user, uid `openhouse`, is the counterpart for all CPs.
- Each CP has exactly one 1:1 conversation: `cp_<id>` ↔ `openhouse`.
- Admins / managers / RMs operate the shared inbox by logging into CometChat **as
  `openhouse`**, so outbound replies render as "Openhouse" — a direct mirror of the
  current WhatsApp inbox (any scoped staff member replies as the org).

## Components

### 1. Backend — provisioning + auth (`backend/routes/comet.py`, new)
- `POST /api/comet/auth-token` (requires portal auth):
  - Resolves the caller's CometChat uid: a CP → `cp_<id>`; an admin/manager/rm → `openhouse`.
  - Ensures that CometChat user exists (create via CometChat REST if missing): set
    `name`, and for CPs a `city` tag.
  - Returns a short-lived CometChat **auth token** for the frontend to log in with.
- REST API Key stays server-side; the frontend never receives it.
- Config (new, in `config.py`, `COMET_` naming): `COMET_APP_ID`, `COMET_REGION`, `COMET_REST_API_KEY`, `COMET_AUTH_KEY`, `COMET_WEBHOOK_USER`, `COMET_WEBHOOK_PASS`. Frontend: `VITE_COMET_APP_ID`, `VITE_COMET_REGION`.
- UI Kit is **v7** (`@cometchat/chat-uikit-react` v7 + `chat-sdk-javascript` v4 + `dompurify`); compose `CometChatConversations` + `CometChatMessageHeader`/`MessageList`/`MessageComposer` (v7 dropped the v6 composites).
- **Plan note:** CometChat **Build (free) caps at 100 users** — dev/testing only; ~3000 CPs require a paid tier in production.
- Blueprint registered in `app.py`; `/api/comet/*` added to the auth-exempt list only
  where appropriate (the token endpoint itself requires portal auth).

### 2. Admin inbox — CometChat React UI Kit (`WhatsAppInbox.jsx` → `ChatInbox.jsx`)
- On mount: fetch an auth token from `/api/comet/auth-token`, log into CometChat as
  `openhouse`, render the UI Kit conversation list + message view + composer.
- **Role-based scoping** (derived from the portal JWT, NOT from CometChat identity):
  - role `admin` → unfiltered: every CP conversation.
  - role `manager` / `rm` → conversations filtered to the user's cities via the CP
    users'/conversations' `city` tag (UI Kit `ConversationsRequestBuilder` with tags).
- Replaces `WhatsAppInbox.jsx` + `WhatsAppThread.jsx` two-pane UI.

### 3. CP-side widget (CP Dashboard)
- On the CP portal: fetch token, log into CometChat as `cp_<id>`, render the UI Kit chat
  with the `openhouse` user. This is the CP's in-portal replacement for WhatsApp.
- Offline reach via CometChat push notifications is a **later** enhancement, not part of
  this migration.

### 4. Per-submission thread (`DetailPanel.jsx`)
- Replace `<WhatsAppThread submissionId=…>` with a UI Kit message view scoped to that
  submission's CP (`cp_<id>`), i.e. the same CP↔openhouse conversation shown in context.

### 5. Message persistence + activity log (Option A)
- CometChat is the source of truth for message history.
- A **new table `chat_messages`** stores every CometChat message (both directions). The
  old `whatsapp_messages` table is **staled out**: kept for historical data, never written
  to or read for new chat, and **not dropped**. New code targets `chat_messages` only.
- `chat_messages` columns (finalize in plan): `id`, `direction` ('inbound'|'outbound'),
  `cp_id`, `sender_uid` (`cp_<id>` or `openhouse`), `staff_id` (which admin sent it, from
  message metadata; nullable — attribution), `body`, `comet_message_id` (UNIQUE, dedup),
  `conversation_id`, `submission_id` (nullable), `sent_at`, `created_at`.
- A **CometChat webhook** (`POST /api/webhooks/cometchat`, new) receives message events and:
  - inserts into `chat_messages` (dedup on `comet_message_id`),
  - writes the `activity_log` entry equivalent to today's `cp_whatsapp_reply`.
- Attribution: since all staff share the single `openhouse` CometChat identity, the
  replying admin's id is carried in the outbound message's metadata and persisted to
  `chat_messages.staff_id`.
- Webhook auth: **HTTP Basic Auth** — CometChat sends `Authorization: Basic base64(user:pass)`,
  NOT a Bearer token. New config `COMET_WEBHOOK_USER` / `COMET_WEBHOOK_PASS`; validate
  `request.authorization`. (Do not mirror the Interakt Bearer pattern.)

### 6. Interakt teardown
- Retire: `services_whatsapp.py` send functions, `routes/webhooks.py` (Interakt inbound),
  the `/api/admin/whatsapp/*` thread/send endpoints, and Interakt config
  (`INTERAKT_API_KEY`, `INTERAKT_API_URL`, `INTERAKT_WEBHOOK_SECRET`, `WA_*`).
- **Stale out** the `whatsapp_messages` table: keep it and its historical rows (do not
  drop, do not write to it). All new chat logs go to the new `chat_messages` table.
- **Untouched:** the reminders cron (`routes/cron.py`) and `cp_reminders_sent`.

## Data flow

- **CP sends** → CometChat (real-time to `openhouse`) → webhook → DB log + activity log.
- **Staff replies** (as `openhouse`) → CometChat (real-time to `cp_<id>`) → webhook → DB log.
- **Inbox load** → token → CometChat login as `openhouse` → conversation list (role-scoped).
- **DetailPanel** → token → CometChat login as `openhouse` → message view for `cp_<id>`.

## Environment keys (user provides)

- Backend: `COMET_APP_ID`, `COMET_REGION`, `COMET_REST_API_KEY`, `COMET_AUTH_KEY`,
  `COMET_WEBHOOK_USER`, `COMET_WEBHOOK_PASS`. (Already set: `COMET_AUTH_KEY`,
  `COMET_REST_API_KEY`. Still needed: `COMET_APP_ID` + `COMET_REGION`.)
- Frontend: `VITE_COMET_APP_ID`, `VITE_COMET_REGION` (public; the auth token is fetched
  from the backend endpoint at runtime — the auth key stays server-side).

## Error handling / edge cases

- Token endpoint fails (CometChat REST down) → surface a non-blocking "chat unavailable"
  state in the UI; the rest of the portal is unaffected.
- CP has no `city` → user created without a city tag; visible only to `admin` role
  (managers/RMs filter by city). Acceptable; flag in review.
- Webhook delivery gaps → CometChat remains source of truth; DB log is best-effort for
  reporting/activity, not for message correctness.
- Duplicate webhook events → dedupe on CometChat message id (like `provider_msg_id` today).

## Testing

- Backend: unit-test the uid resolution (CP→`cp_<id>`, staff→`openhouse`) and the
  webhook persistence/dedup path with a sample CometChat payload.
- Manual: CP sends from CP portal → appears in admin inbox in real time and vice-versa;
  manager sees only their cities' CPs; admin sees all; DetailPanel shows the right CP's
  thread; webhook writes the DB row + activity-log entry.

## Trade-offs / known limitations

- All staff share the `openhouse` CometChat identity → attribution comes from the webhook
  log / message metadata, not CometChat itself.
- UI Kit brings its own theming; may not perfectly match the app's lightweight look.
- No phone/WhatsApp reach — CPs must be in the portal (or receive push, later).
