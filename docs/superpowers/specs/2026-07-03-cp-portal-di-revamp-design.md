# CP Inventory Portal — Direct-Inventory-Style Revamp — Design Spec

**Date:** 2026-07-03
**Build target repo:** `cp inventory test` (this repo) — a **fresh greenfield build**, branch
`feature/di-style-revamp`.
**Source of truth:** `CP-Inventory-Portal` (frozen backend + API contract) and
`Direct_Inventory` (frontend design inspiration) — both read-only references, ported from.
**Status:** Approved design, pending implementation plan.

## 1. Goal & framing

Rebuild the **CP-Inventory-Portal** staff/admin experience — **in this repo** — to look and feel
like **Direct_Inventory**'s frontend, restructured into a clean multi-page app. The backend
(Flask + Postgres) is **ported** from CP-Inventory-Portal into this repo with its API contract
**frozen** (WhatsApp removed, Tickets added); the frontend is built greenfield. This is an
**interface-first** revamp: existing flows and business logic are preserved; the work is
new visual design, a proper page structure, richer filter/expand affordances, and one
net-new feature (Tickets).

**Hard constraint — the HTTP API is frozen.** Multiple external interfaces consume the
CP-Inventory-Portal backend (partner relay, Google Apps Script sync, cron, and — until
removed — the Interakt webhook). No existing endpoint's method, path, auth, request, or
response shape may change. The revamp may only **add** endpoints (Tickets) and **remove**
WhatsApp-only endpoints (whose external callers we will de-configure).

## 2. Decisions (approved)

| # | Decision | Choice |
|---|---|---|
| D1 | CP-facing mobile flow | **Light restyle only** — new tokens/fonts, `wa.me`→`tel:`, no structural change. It is also what the Impersonator embeds, so it must look native. |
| D2 | Tickets | **Add** new `tickets` table + `/api/tickets` blueprint. A ticket links to a **submission** (RM auto-resolved) **or direct-to-RM**. Full parity with Direct. |
| D3 | Frontend build | **Greenfield staff shell** — new `react-router` app + Direct's token CSS + sidebar `Layout`; port each screen's logic onto fresh components. `api.js` contract untouched. |
| D4 | Impersonator | **Embed CP view inline** via a same-origin `<iframe>` reusing the existing per-tab token isolation + server audit. |
| D5 | Tickets visibility | admin → all · manager → **only their team's tickets** (assigned RM reports to them) · rm → **only their own** · viewer → **no access**. |

Defaults confirmed with "everything is fine": `wa.me`→`tel:` swap; drop WhatsApp tables via
forward migration; Fraunces + **Inter** typography; iframe impersonation.

## 3. Scope

**In scope**
- Greenfield staff shell: router, sidebar `Layout`, topbar, design-token CSS system, light/dark.
- 8 staff pages: Home, Submissions, Impersonator, OH Properties, Logs, Users, Tickets, Profile.
- Tickets: new backend blueprint + migration + full frontend workspace.
- WhatsApp: complete removal (frontend + backend + data).
- CP mobile flow: light restyle only.

**Out of scope**
- Any change to a frozen endpoint's contract.
- Structural change to the CP mobile flow (Dashboard / AddUnit / SubmissionDetailModal).
- Direct's coverage map / geo-scope on Profile (CP has no society-geo scope data — YAGNI).
- "New today" stage splits on Home (deferred; would need a small additive endpoint).
- Real ticket notifications (email/push/Slack) — in-app pending-count only, like Direct.
- Team roster on Profile for admin/manager (no existing "my team" endpoint; deferred).

## 4. Design system (ported from Direct, keeping Openhouse brand)

Adopt Direct's architecture: **one `styles.css` `:root` token block + semantic class names +
inline-SVG icon set**. No Tailwind, no CSS modules, no UI kit (matches both repos today).

- **Tokens:** warm-neutral surfaces (`--bg`, `--surface`/`-2`/`-3`), 3-weight borders
  (`--border`/`-2`/`--hairline`), status **triplets** (base / `-bg` tint / `-fg` text) for
  green/amber/red/purple/yellow, radii (`--r-sm/r/r-lg/r-pill/r-input`), warm shadows,
  `--sidebar-w` (248px) / `--topbar-h` (64px).
- **Brand:** keep Openhouse orange as `--brand` (token — swap in one line). CP's current
  `#FF6B2B` is retained; Direct's `#fa541c` is acceptable if a single brand hue is preferred.
- **Typography:** **Fraunces** (display / stat numbers / brand) + **Inter** (UI / tables /
  labels). Tiny uppercase micro-labels use Inter even inside serif areas.
- **Theme:** light default + dark via `[data-theme]` on `<html>`, persisted to `localStorage`,
  a tiny `ThemeContext`, topbar sun/moon toggle.
- **Liftable classes:** `.btn-primary/-ghost/-soft/-link/-danger`, `.pill/.pill-on`,
  `.count-pill(-active)`, `.card-block`, `.data-table`, `.inv-table` + `.inv-th`/`SortTh`,
  `.modal/.modal-backdrop/.modal-wide`, `.field-lbl/.field-val`, `.stage-dot`, `.city-chip`,
  `.role-chip`, `.icon-btn`, `.inv-skel` shimmer, `.bulk-bar`.
- **Interaction motifs:** click-row-to-expand; multi-select stat pills as filters; segmented
  pill toggles; blurred-backdrop modals with click-outside close; floating fixed bulk bar;
  optimistic writes with a global "Saving…" `BusyOverlay`; shimmer skeletons over spinners;
  sticky sortable headers (`↕/▲/▼`); portal-rendered searchable multiselects with chips.

## 5. App shell, routing, navigation

- **Router:** introduce `react-router-dom` v6. `RequireAuth` wraps a `<Layout>` parent route.
  Lazy-load heavy pages (Logs, Users, OH Properties, Tickets, Profile).
- **Layout:** collapsible sidebar (248px ↔ 76px icon-rail, persisted) + topbar
  (page title from a `TITLES` map · context action buttons · notification/theme/logout icon-btns).
  Mobile (`≤860px`): sidebar becomes an off-canvas drawer.
- **Auth/session unchanged:** staff HttpOnly cookie stays; `api.js` `credentials:'include'` and
  its force-logout-on-401 stay. The router mounts on top of the existing bootstrap
  (`meBootstrap` → `/api/me`).

### Navigation & role gating

| Page | admin | manager | rm | viewer |
|---|---|---|---|---|
| Home | ✅ | ✅ | ✅ | ✅ (read-only) |
| Submissions | ✅ | ✅ | ✅ | ✅ (read-only) |
| Impersonator | ✅ | — | — | — |
| OH Properties | ✅ | ✅ | ✅\* | ✅ |
| Logs | ✅ | — | — | — |
| Users | ✅ | — | — | — |
| Tickets | ✅ | ✅ | ✅ | **—** |
| Profile | ✅ | ✅ | ✅ | ✅ |

\* RM OH-Properties access gated by the existing `can_see_oh_properties` flag. No privilege
changes vs. today except Tickets (net-new) and viewer being excluded from Tickets.

**Viewer** remains read-only everywhere it has access: no status/edit/notes/counter/schedule/
bulk/reassign controls render (existing `isStaff` gate, viewer excluded).

## 6. Impersonator — inline embed (D4)

Admin-only page. Existing CP type-ahead search (`GET /api/admin/cps`, `adminCpSearch`) → pick a
CP → `POST /api/admin/impersonate-cp/<id>` (`adminImpersonateCp`) mints a short-lived CP-scoped
JWT → render the restyled CP Dashboard inside a **same-origin `<iframe src="/?impersonate=1#it=<token>">`**
wrapped in a framed **"👁 Viewing as {name} · Exit"** banner.

Why iframe: the existing impersonation is already built on **per-tab `sessionStorage` isolation**
(`auth.js` `bootstrapImpersonation()` captures `#it=` into `oh_impersonation_token`; `api.js`
sends it as `Authorization: Bearer` which the backend reads before the cookie). An iframe is a
separate browsing context, so the CP token stays scoped to the frame and never contaminates the
staff app's cookie-authenticated calls. **Zero backend change; the server-side audit of every
impersonated write is preserved.** "Exit" clears the frame.

Rejected alternative: a React-context-scoped API client threading the CP token per-request —
more invasive to `api.js`, higher risk of leaking the wrong identity.

## 7. WhatsApp removal (complete)

Two independent WhatsApp features exist; remove both.

**A. Interakt integration (clean internal deletion):**
- Delete `backend/services_whatsapp.py`.
- Delete `backend/routes/webhooks.py` (the `POST /api/webhooks/interakt` endpoint) + its
  `app.py` import & `register_blueprint`.
- Delete `backend/routes/cron.py` (`POST /api/cron/send-cp-reminders`, WhatsApp-only, already a
  hard-disabled no-op) + its `app.py` import & `register_blueprint` + `CP_REMINDER_CRON_TOKEN`.
  *(Must remove the top-level `from services_whatsapp import send_template` or the app fails to
  import.)*
- Remove the admin.py WhatsApp block (~lines 4974–5281): `_whatsapp_scope_clause`,
  `_check_thread_in_scope`, and endpoints `GET/POST /api/admin/whatsapp/threads*` +
  `GET /api/admin/submissions/<id>/whatsapp`. Do **not** touch shared helpers
  (`_scoped_city_filter`, `log_activity`, `require_staff`, `require_acting_staff`).
- Remove WhatsApp config (`INTERAKT_API_KEY/URL`, `WA_ENABLED`, `WA_DEFAULT_COUNTRY_CODE`,
  `INTERAKT_WEBHOOK_SECRET`) from `config.py`, `.env`, `.env.example`.
- Frontend: delete `WhatsAppInbox.jsx` + `WhatsAppThread.jsx`; strip the WhatsApp inbox route/
  nav/`WaIcon` from the shell; remove the DetailPanel WhatsApp section; remove the 4 `api.js`
  WhatsApp methods; remove `.wa-*` CSS.
- **DB:** forward migration `DROP TABLE whatsapp_messages;` and `DROP TABLE cp_reminders_sent;`.
  (Do not edit historical migration files.) **This destroys stored WhatsApp history** — accepted.
- `requirements.txt`: keep `requests` (used by `services_otp.py`, `media.py`, `admin.py`).

**B. Customer `wa.me` "Contact RM" deep-links (CP dashboard):**
- Replace the counter-offer "Contact RM" green pill and the floating `.wa-fab` with **`tel:`
  call links** to the RM (from `GET /api/my-rm`). Preserves the only "reach your RM" affordance
  on the CP dashboard without WhatsApp.

**External follow-ups (owner action — not code):**
- **Rotate/revoke the live `INTERAKT_API_KEY`** on Interakt's side (deleting the `.env` line does
  not invalidate it).
- De-configure the Interakt dashboard webhook and the external cron scheduler job (they will
  otherwise get harmless 404s).

**Unaffected:** `services_otp.py` (OTP login delivery — **not** WhatsApp), `timer.js` 7-day
countdown (client-side, independent).

## 8. Tickets — new feature (D2, D5)

Ported from Direct's `api/tickets.py`, adapted to CP's schema and roles. Mirrors Direct's
lightweight two-party issue-conversation model (JSONB message thread, `awaiting` turn-tracker).

### 8.1 Data model — new migration `tickets`
- `id BIGSERIAL PK`
- `submission_id INT NULL` FK `submissions(id)` — property link (null = direct-to-RM). *(CP's
  equivalent of Direct's `oh_id`.)*
- `public_id TEXT NULL` — snapshot of the submission's public id (e.g. `OHLNC0091`) for display.
- `title TEXT NOT NULL`, `summary TEXT`
- `status TEXT NOT NULL DEFAULT 'open'` (`open`|`closed`)
- `awaiting TEXT` (`rm`|`creator`|NULL-when-closed) — drives every "needs my action" count
- `created_by_id INT`, `created_by_name TEXT`, `created_by_email TEXT` (actor snapshot; CP staff
  identity — see §8.5 auth mapping)
- `assigned_rm_id INT` — resolved at creation from the submission's **effective RM**
  (`COALESCE(submissions.listing_rm_id, channel_partners.rm_id)`), or the directly-chosen RM
- `city TEXT` (snapshot), `messages JSONB NOT NULL DEFAULT '[]'`,
  `last_activity_at`/`created_at`/`closed_at TIMESTAMPTZ`, `closed_by_id INT`
- Indexes: `submission_id`, `assigned_rm_id`, `created_by_id`, `status`.
- **Message shape** (JSONB element): `{id (uuid), author_id, author_name, author_email,
  author_role, body, created_at (ISO-8601 UTC)}`. Append atomically:
  `messages = COALESCE(messages,'[]'::jsonb) || %s::jsonb`.

### 8.2 Lifecycle (`awaiting` turn machine)
Create → `open`, `awaiting='rm'`. RM replies → `awaiting='creator'`. Creator/admin replies →
`awaiting='rm'`. Close → `closed`, `awaiting=NULL`. Reopen → `open`, `awaiting='rm'`. Every
mutation bumps `last_activity_at`.

### 8.3 Endpoints (new blueprint `/api/tickets`, all require staff JWT)
- `GET /api/tickets` — scoped list; filters `submission_id`, `status`, `scope=action`; paging
  `limit`(≤500)/`offset`; projection omits `messages`, adds `message_count` + `last_message_at`;
  ordered `last_activity_at DESC`; returns `{items, total}`.
- `GET /api/tickets/pending-count` — `{count}` needing this user's action.
- `GET /api/tickets/<id>` — full ticket incl. `messages`; 404 if not visible.
- `POST /api/tickets` — create (**admin/manager only**). Body `{title, summary?, submission_id? |
  rm_id?}`. Submission mode: resolve `assigned_rm_id` from effective RM (400 if none), snapshot
  `public_id`/`city`; 404 if submission missing. Direct mode: `rm_id` must be an active RM.
  Managers may only target an RM on their team. Writes `activity_log` `ticket_created`.
- `POST /api/tickets/<id>/reply` — body `{body}`; allowed for admin / creator / assigned RM; 409
  if closed; flips `awaiting`; logs `ticket_reply`.
- `POST /api/tickets/<id>/close` and `/reopen` — admin or creator only; close logs
  `ticket_closed` (reopen not logged — matches Direct).

### 8.4 Visibility (D5) & "needs my action"
- **Visibility WHERE:** admin → all; **manager → `assigned_rm_id` is an RM whose manager = me**
  (their team only — no separate "created by me" OR-clause needed, since managers can only create
  on their own team); rm → `assigned_rm_id = me`; **viewer → excluded entirely (no route access)**.
- **Action clause** (feeds `pending-count`, `scope=action`, Home card): rm → open + assigned +
  `awaiting='rm'`; manager/admin → open + created-by-me + `awaiting='creator'`.

### 8.5 Auth mapping (CP roles → ticket model)
CP staff identity comes from the cookie/relay JWT (`role` ∈ admin/manager/rm/viewer; staff user
id + name + phone/email). Tickets are **staff-only**: `cp` and `viewer` never create, reply, or
view. `created_by_id`/`assigned_rm_id` reference CP staff-user ids (RMs live in `rms`, admins in
`channel_partners` per CP's split staff model — resolve consistently with CP's existing
`adminListStaffUsers`/`adminListRms`).

### 8.6 Frontend
- **Tickets page** (Direct's workspace): 3 tabs **Needs my action** / Open / Closed;
  `PAGE_SIZE=50` offset paging with id-dedupe; ticket cards (title + status badge + submission
  line `society · public_id · RM` or "Direct" + reply count + last-activity); reload on
  `tickets:changed`/`tickets:updated` window events.
- **Create** (`CreateTicketButton` in topbar for admin/manager): two modes — *on a submission*
  (debounced submission search, RM auto-resolved and shown) or *direct-to-RM* (RM dropdown;
  managers client-filtered to their team). Also an **inline "New Ticket"** in each submission's
  expand panel (`TicketsSection`, submission mode).
- **TicketModal:** hydrate `GET /api/tickets/<id>`; thread (avatar from email hash, author + role
  chip + timestamp + body, sorted ascending); reply box (Enter sends) when open & allowed; close/
  reopen when open/closed & (admin|creator). Badges: closed → "Closed"; open+`rm` → "Awaiting RM";
  open+`creator` → "Awaiting review".
- **Notifications (in-app only):** sidebar nav dot + count from a 15s poll of
  `/api/tickets/pending-count` (pauses when tab hidden; refetch on focus; broadcasts
  `tickets:updated`); Home "Unresolved Tickets" card.

## 9. Per-page specs

### 9.1 Home (summary)
Landing dashboard, **no board/table** (that lives on Submissions — deliberate divergence from
Direct to avoid duplication). Data from `/api/admin/submissions` stage counts +
`/api/tickets/pending-count` → **zero backend change**.
- Stage summary grid (Direct `QuadCard`/`StatTile`), grouped over CP's 9 stages: *Intake*
  (Unapproved, Submitted), *Visits* (Visit Requested, Scheduled, Completed), *Deals* (Offer
  Given, Closure), *Rejections* (Price Rejected, Rejected + top reasons). Big Fraunces counts;
  each stat clickable → Submissions pre-filtered to that stage.
- Unresolved-Tickets card → `/tickets` (hidden for viewers).
- Respects role scope (RM own / manager team / viewer city) — same scoping the board applies.

### 9.2 Submissions (board ⇄ table toggle)
**Toolbar** (Direct style): city tabs · search (submit-to-apply) · Filters (N) · **view toggle
(Board/Table segmented pill)** · Select (bulk) · Download CSV · **+ Add Inventory** (on-behalf).

**Board view** — CP's kanban restyled with tokens. Cards keep CP's exact content: society /
city / `public_id`; `tower-unit · F{floor}`; BHK + sqft chips; **match badges**
(Perfect/Collated/Submissions/Moved-from/⚠weak, first three clickable → `MatchDetailsModal`);
schedule badge (Visit Scheduled); `status_reason` pill (staff); **price grid** (Asking / Counter
+ tally / OH Price via `formatOhPrice`); RM line; footer (`timeAgo · cp_name` + on-behalf chip).
Per-stage lazy pagination (`IntersectionObserver`, `PAGE_SIZE=15`) preserved. Row/overlay tint
priority preserved (perfect > submissions > collated > moved-from).

**Table view** — Direct's sticky **sortable** `inv-table` with CP columns: Listing ID (+`PERFECT`/
`WITHDRAWN`/`📅` tags) · Society (+⚠weak) · City · Unit (`tower-unit · F{floor}`) · Config
(`bhk BHK · sqft`) · Asking · OH Price · CP (`cp_name`/`cp_code` + on-behalf) · Status (pill +
`status_reason` + match chips) · Submitted. **Row click → Direct `ExpandPanel`**.

**Expand panel** (CP detail re-housed into Direct's sections; lazy-fetch
`GET /api/admin/submissions/<id>`):
1. **🏠 Unit Details** — BHK, Area, Floor, Tower, Unit, Occupancy. "✎ Edit Details" (admin →
   `EDITABLE_FIELDS` grid via `adminUpdateSubmission`).
2. **💰 Pricing** — Asking (orange), OH Price, Rate/sqft; **Counter Offer** (tally, state, broker
   counter, CP note; staff "Send counter offer" via `adminSendCounterOffer` per existing rules).
3. **👤 People** — CP (link → `CpHistoryDrawer`), cp_code/phone, on-behalf note; Seller
   name/phone (missing-flag); **Assigned RM** with admin/manager reassign-scope radio (this
   listing / + future society mapping) via `adminSetListingRm`.
4. **📋 Status + Notes** — status `<select>` (STAGES; AUTO_ONLY disabled; Rejected → reason
   dropdown) via `adminChangeStatus`; **ScheduleVisitSection** (existing pre-flight + Forms push
   via `adminScheduleVisit`); notes thread + add-note (`adminAddComment`); activity events.
5. **🎫 Tickets** — `TicketsSection` (list this submission's tickets + inline create).
6. **🖼 Media** — photo grid (staff add/remove via `uploadToCloudinary` + `adminUpdateSubmission`),
   Drive links, CP-shared media, lightbox.

**Board card click** → Direct's wide `CardDetailModal` embedding the same expand sections (one
detail component, two entry points).

**Filter modal** (Direct `FilterPanel`, CP fields — detailed): Society multiselect · City · BHK
pills · **Stage** multi-select · **Match type** (Perfect/Collated/Submissions/Weak) · **Missing
info** (no asking price / no seller) · Asking-price range · OH Price (Has / Check-Price) · **RM**
multiselect (admin/manager) · **Rejected reason** (when a rejected stage is filtered) ·
Date-submitted presets (Today/Yesterday/Week/Month/Custom). Two-state pattern (form vs applied)
so the toolbar shows a filter count + Reset.

**Bulk bar** (Direct floating `.bulk-bar`): Bulk Status (`adminBulkStatus`) · Bulk Schedule Visit
(`adminBulkScheduleVisit`) · Bulk Reassign RM (`adminBulkReassignListingRm`, admin/manager).
"Select all matching" fetches every matching id across pages.

### 9.3 Impersonator
See §6.

### 9.4 OH Properties
Same data & features as today (`GET /api/admin/external-inventory`: collated_data + properties
merge, D/F type toggle, facets, server sort + Prev/Next pagination `PAGE_SIZE=100`) — re-skinned
into Direct's shell: toolbar + search + type toggle, the two filter rows folded into a **Direct
`FilterPanel` modal** (City, Source w/ `-Scraping` canonicalization, BHK, Floor, Area range, Date
presets), sticky sortable `inv-table` (Type/ID/Source/Society/City/BHK/Floor/Tower/Unit/Area/Date),
Direct pagination. **No functional change.**

### 9.5 Logs
CP's existing `GET /api/admin/activity-log` + `/facets`, rendered in Direct's **Logs** layout:
head + result count; single-line filter bar (search + Action/Category/Actor selects from facets +
date range + Apply); amber **500-cap banner** (`cap_reached`); sticky sortable table (Timestamp ·
UID · Actor · Action · Category · Details). **Smart `Details` renderer** formats each action type
(field `before→after`; notes; visit scheduled/cancelled; counter-offers; **ticket
created/reply/closed**; syncs; bulk ops) with an emoji summary and a raw-JSON fallback. `OHL…`
UIDs → `CardDetailModal`. **"Log every detail":** backend logging is server-side and untouched by
the frontend rewrite; Tickets *adds* its events; the Details renderer is extended to cover every
CP action category so nothing shows as raw JSON.

### 9.6 Users (was Admin Panel)
Direct's **Users** layout over CP's staff-user model (unchanged endpoints
`adminListStaffUsers`/`adminAddStaffUser`/`adminPatchStaffUser`/`adminForceLogoutUser`/`...All`):
- **"Add user"** card: Name / 10-digit phone / email / Role (RM/Manager/Viewer/Admin); a **city
  picker appears for Viewer** (required).
- **"All users"** `data-table`: inline **Role** select (blocked across the admin↔rms `source`
  boundary with the existing explanatory alert), **OH-Properties** checkbox
  (`can_see_oh_properties`), **Status** pill, **Force-logout** (per-user) + **Force-logout-all**
  (with confirm), Active/Inactive. Inactive rows dimmed. Sortable headers.

### 9.7 Tickets
See §8.6.

### 9.8 Profile
Direct's **MyProfile** identity layout from `GET /api/me` (**zero backend change**): avatar +
name + role chip + email/phone; scope row (city for viewer/RM; manager line for RM/manager).
**Coverage map omitted** (no CP geo-scope data). **Team roster deferred** (no existing "my team"
endpoint).

### 9.9 CP mobile flow — light restyle (D1)
Apply new tokens + Fraunces/Inter to `Dashboard.jsx`, `AddUnit/*`, `SubmissionDetailModal.jsx`;
swap `wa.me`→`tel:` (§7B); **no structural change**. Ensures the Impersonator embed looks native.

## 10. Logging — "every small detail"
Backend `activity_log` write coverage (submissions, staff mutations, auth, CP↔RM) is server-side
and **unchanged** by the frontend rewrite. Additions: Tickets writes `ticket_created` /
`ticket_reply` / `ticket_closed` via CP's existing `log_activity()` helper. The Logs page's
`Details` renderer must handle **every** action category present in CP's log (no raw-JSON gaps).

## 11. Frozen API contract (reference)
67 active endpoints across 10 blueprints. **61 frontend-facing**, **6 external-only** (5 sync +
1 cron + 1 webhook), plus the partner **relay** (cross-cutting `X-API-Key` + `X-Broker-Id` into
every `@require_auth` endpoint). The full enumeration (method · path · auth · purpose · consumer)
is the authoritative contract; none of these change. WhatsApp-only endpoints
(`/api/webhooks/interakt`, `/api/cron/send-cp-reminders`, `/api/admin/whatsapp/*`,
`/api/admin/submissions/<id>/whatsapp`) are the **only** removals; their external callers are
de-configured (§7). New Tickets endpoints (§8.3) are the **only** additions.

Dormant-but-keep (present in backend/`api.js`, no active SPA caller — do not remove):
`/api/submissions/stats`, `GET /api/submissions/<id>`, `/withdraw`, `/asking-price`,
`getRmContacts`, `getSocietyInventory`, `checkDuplicate`, `getRmOptions`,
`adminDeleteSubmission`, `adminSetCpRm`, `adminBulkReassignRm`, `health`.

## 12. Migrations (new, forward-only)
1. `create_tickets` — the `tickets` table + indexes (§8.1).
2. `drop_whatsapp_messages` — `DROP TABLE whatsapp_messages;`
3. `drop_cp_reminders_sent` — `DROP TABLE cp_reminders_sent;`

Historical migration files are not edited. Migrations follow CP's existing dated-file convention.

## 13. Optional / additive niceties (low-risk, may include)
- Direct's **TTL GET cache** + in-flight de-dup + global `BusyOverlay` in the api layer (snappier
  feel; additive, no contract change).
- Sidebar collapse + theme persistence to `localStorage`.

## 14. Risks & mitigations
- **Impersonation embed** — mitigated by reusing the existing iframe/sessionStorage isolation
  (§6); verify the CP token never leaks into staff calls and "Exit" fully tears down the frame.
- **Ticket ↔ submission RM resolution** — effective RM is a snapshot at creation; if a submission
  is later reassigned, the ticket stays pinned to the original RM (matches Direct; acceptable).
- **Frozen contract** — enforce by only adding the Tickets blueprint and only deleting WhatsApp
  routes; a contract check (grep the endpoint list) before merge.
- **Greenfield shell regressions** — every existing staff action must remain reachable; the
  per-page specs above are the coverage checklist.

## 15. Verification approach
- Backend: a focused test for the Tickets blueprint (create/reply/close/reopen + visibility per
  role D5 + action-clause pending-count). WhatsApp removal verified by app-boot + endpoint-gone
  checks.
- Frontend: drive each page in the running app (webapp-testing / manual) — board+table+expand+
  filter+bulk on Submissions, ticket create/reply/close, impersonate-and-exit, Users mutations,
  Logs rendering, OH Properties parity, theme toggle.
- Contract: diff the live endpoint list against §11 (only Tickets added, only WhatsApp removed).
