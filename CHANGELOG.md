# Changelog

All notable changes pushed to production are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Each entry corresponds to one production push (one or more bundled commits).

## [Unreleased]

## [2026-06-18] — Show assigned RM on board card

### Added
- **Assigned RM line on each board card.** The card footer now shows
  `RM - {name}` below the date/CP line, using the effective RM —
  `s.listing_rm_name || s.assigned_rm_name` — so the per-listing
  override wins when set, else the CP's permanent RM. Mirrors the
  `COALESCE(s.listing_rm_id, cp.rm_id)` rule in `_scoped_city_filter`,
  so the card matches the owner the backend recognises. No backend or
  DB change — both fields were already in the slim board SELECT.

## [2026-06-18] — Fix: viewers couldn't see the Unapproved board column

### Fixed
- **Viewer role missed the Unapproved column on the kanban board.**
  `isViewer` was computed at the top of
  [`Admin/index.jsx`](frontend/src/screens/Admin/index.jsx) and used by
  the counts panel filter, but was never passed down to `BoardView`.
  `BoardView`'s own visible-stages filter only consulted
  `isStaff || isAdmin`, and since the Unapproved stage is marked
  `adminOnly: true` in `STAGES`, viewers got the other six columns but
  Unapproved rows had no column to render in — silently invisible
  despite the backend happily returning them. The board now matches the
  counts panel pattern (`isStaff || isViewer || !s.adminOnly`) and
  `isViewer` is threaded into the `BoardView` props. Pure frontend fix —
  `_scoped_city_filter` had always been returning Unapproved rows to
  viewers; only the rendering was gating them.

## [2026-05-23] — Real status: granular stage preserved alongside the 7 board stages

### Added
- **Real status on the admin board card.** Each card now shows the
  listing's true lifecycle stage (e.g. `OH Rejected`, `Negotiation`,
  `Token Transferred`) as an "Actual" label right above the price
  divider — but only when it differs from the card's board stage.
  Staff-only: rendered on the admin board, and `real_status` is
  returned only by the `/api/admin` routes, never by the CP-facing
  `/api/submissions` routes.
- **"Real Status" column in the CSV export**
  (`GET /api/admin/submissions.csv`), placed right after "Status", so
  the next round of status mapping has the granular values to work from.

### Changed
- **Bulk status clean-up — 1,717 submissions.** An admin-edited export
  CSV was applied via the new
  [`backend/import_status_update.py`](backend/import_status_update.py):
  `submissions.status` corrected to one of the 7 board stages (963 rows
  changed) and `submissions.real_status` set to the verbatim stage on
  every row. 18 granular statuses were projected onto the 7 board
  stages per an admin-supplied mapping (OH Rejected → Duplicate
  Rejected, Negotiation → Offer Given, …). Silent update — no
  `submission_events`, no notifications, reminder timers untouched.

### Schema
- **Migration** [`backend/migrations/2026-05-23-real-status.sql`](backend/migrations/2026-05-23-real-status.sql).
  Adds `submissions.real_status VARCHAR(40)` — the granular real-world
  stage; `status` stays the 7-stage projection the board, counts and
  filters depend on.

## [2026-05-13] — Fix: role flips to/from viewer were rejected

### Fixed
- **`PATCH /api/admin/staff-users/rm/<id>` rejected any role change
  to or from `viewer`** with the cross-table error
  *"Role moves between the channel_partners (admin) and rms
  (rm/manager) tables aren't supported."* — even though viewer
  lives in `rms` alongside rm/manager. Reported by an admin trying
  to demote an RM to viewer.

  The backend now accepts all three rms-table roles (rm / manager /
  viewer) for `source='rm'` PATCH requests. The endpoint sets
  `is_manager` and `is_viewer` together so the table's CHECK
  constraint (`NOT (is_viewer AND is_manager)`) is always satisfied.

  Flipping a user TO viewer additionally requires a `city_id`
  (viewers are city-bounded). If the row already has one, that's
  used; otherwise the PATCH body must include `city_id` and the
  Admin Panel prompts for it inline.

  Cross-table admin ↔ rms moves still aren't supported — the error
  message now mentions viewer and uses "Deactivate + re-add".

## [2026-05-13] — Viewer role + stage-count filter fix

### Added
- **New staff role: `viewer`.** Read-only, city-bounded. A viewer
  sees every active listing in their assigned city (regardless of
  which RM / Manager owns it) but cannot perform any mutation —
  status changes, comments, edits, scheduling, reassignment,
  on-behalf submissions, photo uploads are all hidden from the UI
  and rejected by the backend.

  Why: ops needs trusted observers (city leads, auditors, finance)
  to track pipeline progress without the risk of an accidental
  status nudge or reassign.

### Schema
- **Migration** [`backend/migrations/2026-05-13-viewer-role.sql`](backend/migrations/2026-05-13-viewer-role.sql).
  Adds `rms.is_viewer BOOLEAN NOT NULL DEFAULT FALSE` plus a CHECK
  constraint forbidding `is_viewer AND is_manager` on the same row.
  Idempotent. Must run on prod App DB **before** this code ships.

### Backend
- `auth.require_staff` now accepts `role IN ('admin','manager','rm','viewer')`.
- **New decorator `auth.require_acting_staff`** rejects viewers with
  403. Applied to every mutation endpoint that was previously gated
  only by `@require_staff`:
  - `change_status`, `send_counter_offer`, `add_comment`,
    `schedule_visit`, `bulk_schedule_visit`, `bulk_status`,
    `create_submission_on_behalf`.
  Endpoints already gated by `@require_admin_role` or
  `@require_admin_or_manager` are unchanged — those decorators don't
  match `'viewer'` so viewers were already blocked.
- **Scope filters extended for viewers:**
  - `_scoped_city_filter` → `AND s.city_id = <my city>` when role=viewer.
  - `_scoped_cp_filter`   → `AND cp.city_id = <my city>` when role=viewer.
  Both deny everything when the viewer has no `city_id` (misconfigured
  account).
- **JWT** now carries `is_viewer` alongside `is_manager`. The role
  string is one of `admin / manager / rm / viewer` (precedence:
  viewer > manager > rm).
- **`/admin/staff-users` list** returns `role: 'viewer'` and
  `city` / `city_id` on the row so the Admin Panel can show where
  the viewer is assigned. Defensive fallback if `is_viewer` column
  isn't there yet (partial migration).
- **`POST /admin/staff-users`** accepts `role='viewer'` + `city_id`
  in the request body. Validates `city_id` is required when role is
  viewer (server returns 400 otherwise).

### Frontend
- **`App.jsx`** routes viewers into the Admin screen (alongside
  rm / manager / admin).
- **`Admin/index.jsx`** — viewers see: city scope pill (locked to
  their city), search, filters (incl. RM dropdown), stage cards,
  board/table view, Export, OH Properties button. Viewers don't see:
  city tabs (their city is fixed), Select / Bulk action bar,
  + Add Inventory, 📜 Activity Logs, ⚙ Admin Panel. Topbar role
  label reads "Viewer · <city>".
- **`DetailPanel.jsx`** — for viewers, status is rendered as plain
  text (not a dropdown), Counter Offer / Comment input / Schedule
  Visit action / ✏ Edit / Photos upload are all hidden. The
  Assigned RM section uses the existing read-only branch.
- **`AdminPanel.jsx`** — Add User form has a new "Viewer (city
  read-only)" role option. Picking it reveals a city dropdown
  (required). User-list table shows `📍 <city>` next to viewer rows
  so it's obvious at a glance.

### Also fixed
- **Stage-count cards now honor the RM filter.** Picking a different
  RM in the filter dropdown left the seven stage counters at the
  top showing city-wide totals — the underlying `_stage_counts`
  query was missing the `rm_id` clause that `_apply_filters` has on
  the list query. Both paths now use the same effective-RM logic
  (per-listing override beats CP's permanent rm).

## [2026-05-09] — Add Inventory on Behalf: pick city first, see every CP in it

### Changed
- **The on-behalf flow now starts with a city picker.** Staff
  (RM / Manager / Admin) selects Noida / Gurgaon / Ghaziabad, then
  the CP search runs **inside that city**, ignoring the caller's
  personal CP scope. Any active CP of the chosen city is selectable.
  Previously, the search was limited to CPs already assigned to the
  caller — which was wrong for the use case (RMs frequently get
  inventory from CPs that aren't on their book).

  Switching the city resets the CP picker (forces a re-pick so we
  don't end up pointed at a now-mismatched CP).

### Endpoints
- **`GET /api/admin/cps`** now accepts a `city` query param. When
  given, restricts results to that city AND bypasses
  `_scoped_cp_filter`. Without `city`, falls back to the old
  scope-filtered behavior (legacy callers, if any, are unaffected).
- **`POST /api/admin/submissions/on-behalf`** no longer enforces
  `_scoped_cp_filter` on `target_cp_id`. Active + non-admin CP is
  enough. 404 instead of 403 when the CP doesn't exist.

### Why this is safe
The relaxation only affects the on-behalf path:
1. Reading CPs of a city requires staff role + the explicit `city`
   filter (the `@require_staff` decorator gates everything).
2. Submitting on a CP's behalf already records the staff member as
   `submitted_by_name`, and writes a `submission_event` annotating
   *"submitted by [staff] on behalf of [CP]"*, so the audit trail
   captures cross-scope submissions clearly.
3. `is_active` + `is_admin=FALSE` are still enforced.

## [2026-05-03] — Activity Logs: dashboard-wide mutation feed (admin)

### Added
- **`📜 Activity Logs` page** in the admin topbar (left of the
  ⚙ Admin Panel button). Mirrors the org-wide activity-log UX —
  Timestamp / UID / Actor / Action / Category / Dashboard / Details
  with filters for action, category, actor email/name, UID search,
  and date range. Server-side paginated; hard cap of 500 results
  (matches the "narrow your filters" prompt from the org-wide log).

- **`activity_log` table** is the new single source of truth for
  who did what when, separate from the per-submission
  `submission_events` timeline. Every staff or CP-actored mutation
  appends one row.

- **`log_activity()` helper** in `backend/activity_log.py`. Inserts
  into the caller's transaction (so the audit row is committed/rolled
  back together with the mutation). Reads the actor from `flask.g.user`
  and never raises — a transient hiccup must not break business logic.

- **Wired into ~17 mutation sites:**

  | Action | Category |
  |---|---|
  | status_change, status_change_bulk | submission |
  | counter_offer_sent | submission |
  | comment_added | submission |
  | submission_edited | submission |
  | submission_deleted | submission |
  | submission_created (CP), submission_created_on_behalf | submission |
  | submission_withdrawn (CP) | submission |
  | counter_offer_accepted, counter_offer_rejected (CP) | submission |
  | visit_scheduled, visit_scheduled_bulk | submission |
  | listing_rm_set, listing_rm_cleared (single + bulk) | submission |
  | cp_rm_changed, cp_rm_changed_bulk | cp_rm |
  | cp_note_added, cp_note_deleted | note |
  | staff_user_added, staff_user_updated, force_logout_user, force_logout_all | staff_user |

### Endpoints
- `GET /api/admin/activity-log` — admin only. Filters listed above;
  default page_size 100, hard cap 500.
- `GET /api/admin/activity-log/facets` — distinct values for the
  filter dropdowns. Computed over the entire table (NOT the current
  filter set), so dropdowns don't narrow as filters are applied —
  same anti-narrowing rule we settled on for OH Properties.

### Schema
- **Migration** [`backend/migrations/2026-05-03-activity-log.sql`](backend/migrations/2026-05-03-activity-log.sql).
  Idempotent (`CREATE TABLE IF NOT EXISTS`). Adds the table plus
  five indexes (created_at, action, category, actor, entity_uid).
  Must run on prod App DB **before** this code ships, per Convention #2.

### Notes
- Actor name + email are JOINed at read time from
  `channel_partners` / `rms` (we don't snapshot them on insert
  because the JWT only carries phone+id). If a user is later renamed
  or deleted, historical log rows will reflect the *current* state
  of the row — this matches how the org-wide log behaves and keeps
  the UI clean. Phone is snapshotted (free from the JWT) as a
  stable identifier in case the row is gone entirely.
- `dashboard` column defaults to `'CP Inventory'` so rows are
  shape-compatible with the centralized aggregator if you later
  pipe them upstream.

## [2026-05-03] — Fix: status change 500'd for RM users

### Fixed
- **`POST /api/admin/submissions/<id>/status` returned 500 for any
  RM user** (and the same was true for several other staff endpoints).
  An RM in the field reported it while moving a listing from
  Submitted → Visit Scheduled.

  Root cause: five staff-callable endpoints used `g.user["cp_id"]`
  (subscript access) when writing to `submission_events.actor_cp_id`.
  The JWT for an RM only has `rm_id`, not `cp_id`, so subscript
  raised `KeyError` → Flask returned 500.

  Fix: switched every `submission_events` insert path to
  `g.user.get("cp_id")`, matching the existing pattern in
  `set_listing_rm` / `bulk_reassign_listing_rm` (the column already
  accepts NULL — RM-actored events store NULL). Endpoints touched:
  `change_status`, `send_counter_offer` event row, `add_comment`,
  `edit_submission` event row, `bulk_status` event row.

  Admin-only endpoints (`delete_submission`, `add_cp_note`) and the
  `submissions.counter_offer_by` UPDATE on `send_counter_offer` were
  left as-is — they're not currently exposed to managers via UI.

## [2026-05-03] — Managers get full reassign parity with Admins

### Added
- **Managers can now reassign listings or CPs to any RM**, with the
  same UI admins see. The "👤 Reassign RM…" bulk button on the admin
  board is visible to both `role=admin` and `role=manager`. The same
  applies to single-listing reassign on the detail panel.

### Changed — endpoints opened to managers
All four reassign endpoints are now gated by the new
`@require_admin_or_manager` decorator (instead of `@require_admin_role`):

  | Endpoint | What it does |
  |---|---|
  | `PATCH /api/admin/submissions/<id>/listing-rm` | Single listing-RM override |
  | `POST  /api/admin/submissions/bulk-reassign-listing-rm` | Bulk listing-RM override |
  | `PATCH /api/admin/channel-partners/<cp_id>/rm` | Single CP-permanent RM |
  | `POST  /api/admin/cps/bulk-reassign-rm` | Bulk CP-permanent RM |

### Manager constraints (admin is unrestricted)
The only manager-vs-admin difference is **scope of subjects** — i.e.
which listings / CPs the caller may act on. Target RM is unrestricted
for both:

- **Listing-RM endpoints** apply `_scoped_city_filter` (the same rule
  that powers list / detail visibility). Out-of-scope rows are silently
  skipped in bulk and return 404 in single-listing.
- **CP-permanent endpoints** apply `_scoped_cp_filter` against the
  `channel_partners cp` alias. Out-of-scope CPs come back as
  "CP not found or out of scope" / are absent from per-CP results.

### Other plumbing
- **`GET /api/admin/rms`** now also returns each RM's `manager_id`
  (kept from the team-filter iteration; harmless when unused).
- **`GET /api/me`** for an RM now also returns numeric `rm_id` (it
  previously only had `id` formatted as `rm-{N}`). Useful for the
  frontend when it needs to identify "self" against the rms table.

### Why
A manager asked why "Reassign RM…" was no longer available on the
bulk toolbar. It actually never was — admin-only since introduction
(`0d9725c`). User then asked for "complete functionality of
re-assigning… same as admin" — i.e. full parity, not a constrained
subset. So the listing-only / team-only intermediate version that
shipped earlier in this branch is replaced with the parity model.

## [2026-05-03] — Fix: per-listing RM override never reached the receiving RM

### Fixed
- **Per-listing RM override silently failed on the receiving RM's side.**
  When admin used "This listing only" reassignment to push a single
  submission to a different RM, `submissions.listing_rm_id` got set
  correctly and the activity log showed the override — but the target
  RM never saw the listing in their portal. The CP's permanent RM
  continued to see it.

  Root cause: the RM scope filter in [backend/routes/admin.py](backend/routes/admin.py)
  (`_scoped_city_filter`) and the admin's "filter by RM" branch in
  `_apply_filters` both matched only on `channel_partners.rm_id` (the
  CP's permanent RM). Neither path consulted `s.listing_rm_id`, so
  the override was effectively write-only.

  Fix: both paths now match on **effective RM** =
  `COALESCE(s.listing_rm_id, cp.rm_id)`. A listing is visible to RM X
  iff either (a) `listing_rm_id = X`, or (b) `listing_rm_id IS NULL`
  and the CP's permanent `rm_id = X`. Manager scope expands the same
  rule across `me + manager_id = me`. Flows through every endpoint
  that uses the scope helper — list, count, detail, CSV, dashboard.

  Repro: admin sets "This listing only" → Aman Dixit on a CP whose
  permanent RM is Kavita Rawat. Before this fix, Aman saw nothing;
  Kavita still saw it. After: Aman sees it, Kavita does not.

## [2026-05-01] — Admin Panel: staff-user management + force logout + OH-Properties gate

### Added
- **Admin Panel modal** (admin-only, `⚙` icon button in the topbar,
  immediately left of the logout button). Manages staff users — RMs,
  Managers, Admins. CPs are not part of this panel; they have their
  own onboarding flow.

  Capabilities:
  - **Add user** — name + 10-digit phone + role (`RM` / `Manager` /
    `Admin`) + optional email. Phone uniqueness enforced per-table.
    `RM` and `Manager` go into `rms`; `Admin` goes into `channel_partners`
    with `is_admin=TRUE`.
  - **Change role** within the same table — `RM ↔ Manager` flips
    `rms.is_manager`. Moves between Admin and RM/Manager are rejected
    (different tables); the UI surfaces an alert telling the admin to
    Remove + re-add.
  - **OH Properties access toggle** — `can_see_oh_properties` per user.
    `GET /api/admin/external-inventory` now 403s when this is FALSE.
  - **Deactivate / Re-activate** — toggles `is_active`. Action button
    is labelled "Deactivate" (not "Remove") since the row is preserved
    for audit and can be reactivated.
  - **Force logout per user** — sets `force_logout_at = NOW()`.
  - **Force logout all** — sets it on every active staff user (admins
    + RMs/managers). The triggering admin is included; their next
    request 401s and the existing force-logout-on-401 frontend handler
    redirects them to login. Confirmation prompt prevents accidental
    fires.

  **Backend** ([backend/routes/admin.py](backend/routes/admin.py)):
  ```
  GET    /api/admin/staff-users
  POST   /api/admin/staff-users
  PATCH  /api/admin/staff-users/<source>/<id>     ('cp' | 'rm')
  POST   /api/admin/staff-users/<source>/<id>/force-logout
  POST   /api/admin/staff-users/force-logout-all
  ```
  All `@require_staff` + `@require_admin_role`.

### Changed
- **JWTs now include `iat`** (issued-at). The auth middleware
  ([backend/auth.py](backend/auth.py)) compares it against the user's
  `force_logout_at` on every request and rejects with `401 Session
  ended by admin` if the token was issued before that timestamp. The
  frontend's existing 401 handler then clears the session and reloads,
  so the user lands on Login.

### Schema
- **Migration** [`backend/migrations/2026-05-01-admin-panel.sql`](backend/migrations/2026-05-01-admin-panel.sql)
  adds two columns to each of `channel_partners` and `rms`:
  - `force_logout_at TIMESTAMPTZ NULL`
  - `can_see_oh_properties BOOLEAN NOT NULL DEFAULT TRUE`

  Idempotent (`ADD COLUMN IF NOT EXISTS`). Existing rows default to
  `can_see_oh_properties = TRUE` so nobody loses access at deploy time.
  Must run on prod App DB **before** this code ships, per Convention #2.

### Notes
- Auth's force-logout check fails open if the DB is unreachable —
  preferable to kicking everyone out on a transient hiccup.
- Force-logout-all is intentionally global (including the admin who
  pressed it). If you need a "log everyone else out" variant, that's
  a separate endpoint we can add.

## [2026-05-01] — Admin: scroll-to-top when entering/leaving subviews

### Fixed
- Returning from the **OH Properties** page (or **Add Inventory on
  Behalf**) to the admin board kept whatever `window.scrollY` was
  left behind, so the board landed mid-page instead of at the top.
  Added a single effect in `Admin/index.jsx` that scrolls the
  window to top whenever the `addingInventory` or
  `externalInventoryOpen` flag toggles in either direction.

## [2026-05-01] — OH Properties: BHK normalisation (collapse "2 BHK" / "2BHK")

### Fixed
- **BHK dropdown showed duplicate entries** like `2 BHK` and `2BHK`,
  `3 BHK` and `3BHK`, etc. The underlying `collated_data.bedrooms` and
  `properties.configuration` columns store both spaced and unspaced
  forms inconsistently. Now collapsed:
  - **Display:** added `_canonical_bhk()` helper that matches
    `^\s*(\d+(?:\.\d+)?)\s*BHK\s*$` (case-insensitive) and rewrites
    to a single canonical form `<n> BHK`. Strings that don't match
    that pattern (e.g. `Studio`) pass through trimmed.
  - **Facets dropdown:** values from both tables are canonicalised
    before deduping, so `2 BHK` / `2BHK` collapse into a single
    `2 BHK` entry. Result: 9 entries (1, 2, 2.5, 3, 3.5, 4, 5, 6, 7 BHK).
  - **Filter SQL:** `LOWER(REGEXP_REPLACE(<col>, '\s+', '', 'g'))`
    on both column and param so picking `2 BHK` matches rows storing
    `2 BHK`, `2BHK`, `2  BHK`, `2bhk`, etc.
  - **Row output:** `r["bhk"]` in API responses is now the canonical
    form so the BHK column in the table renders consistently
    regardless of which spacing the underlying row used.

  Underlying DB values are untouched.

## [2026-05-01] — OH Properties: facet dropdowns are global (not narrowed by current filters)

### Fixed
- **You couldn't switch from one filter value to another without first
  going to "All".** Source / BHK dropdowns were populated from the
  current filtered row set, so picking `City: Gurgaon` would shrink
  the BHK options to only what existed in Gurgaon — and once you'd
  picked `BHK: 2 BHK`, the Source list shrank further to only what
  existed for "Gurgaon + 2 BHK", etc. To swap to a different value
  you had to first clear the existing filter back to All.

  Fix: the Source / BHK / City facet lists are now the **global**
  set of distinct values across both tables, regardless of the
  caller's current filters. Implemented as
  `_ext_inventory_global_facets()` with a 5-minute in-memory TTL
  cache (4 lightweight `SELECT DISTINCT` queries; refreshed lazily).

  Filter behaviour itself is unchanged — the result rows are still
  narrowed by every active filter; just the dropdown options no
  longer narrow alongside.

### Note
- The cache is process-local; in a multi-worker deploy each worker
  warms its own cache independently. Acceptable for this read-only
  page.

## [2026-05-01] — OH Properties: split filter rows + bolder column-header bar

### Changed
- **Filter row split into two explicit sticky rows.** The previous
  single wrap-around filter row was taller than its declared `height`
  whenever it broke onto a second line, which let the column-header
  row's `top: 172` slip up under the actual bottom of the filter row.
  Now:
  - Row 1 (sticky `top: 112`, height 56): City · Source · BHK · Floor · Area (sqft)
  - Row 2 (sticky `top: 168`, height 56): Date chips + custom range + Clear filters
  Both rows are `flex-wrap: nowrap` with horizontal scroll on overflow,
  so they never grow taller than declared.
- **Column-header row is now visually heavier** — dark navy background
  (`#1a1a2e`) with white uppercase text, slightly bigger letter-spacing,
  thicker bottom border. The active sort column highlights orange
  (`#FF6B2B`) against the dark base. This creates a clear "data table
  starts here" delimiter beneath the lighter filter bars above.
- Column-headers `top` is now `224` (= page header 56 + search 56 +
  filter1 56 + filter2 56).

### Changed
- **Type labels shortened** from "D Data" / "F Data" to just **"D"** / **"F"**.
  Applies to:
  - The type-pill badge in the table (a touch wider padding so the
    one-letter pill still has visible body)
  - The Both / D / F filter toggle buttons (`D (X)` instead of `D Data (X)`)
  - The backend response's `type` field (now the canonical value too)

- **`-Scraping` source variants collapse into their base name.** The
  scrape pipeline emits both "99acres" and "99acres-Scraping" for the
  same logical source (same for "magicbricks" / "magicbricks-Scraping"
  and "housing" / "housing-Scraping"). They're now treated as one source:
  - **Source filter dropdown** shows only the canonical name. Picking
    `99acres` matches *both* `99acres` and `99acres-Scraping` rows.
  - **Source cell** in the table strips the `-Scraping` suffix on
    display.

  Backend match uses `REGEXP_REPLACE(source, '-[Ss]craping$', '')` on
  both the column and the param, so the comparison is symmetric. Facet
  list is deduped after the same canonicalisation.

  Underlying DB values are unchanged.

## [2026-05-01] — Date sort fix on OH Properties

### Fixed
- **Date column sort wasn't reflecting calendar order.** Two bugs:
  - `collated_data.posting_date` is a `DATE` (ISO `YYYY-MM-DD`),
    `properties.schedule_submitted_at` is `TIMESTAMPTZ` (ISO
    `YYYY-MM-DDTHH:MM:SS+TZ`). Lexicographic sort of the raw ISO
    strings put the bare-date and the timestamped same-day row in
    a confusing order. Now the sort key for the date column
    truncates to the first 10 chars (`YYYY-MM-DD`), so same-day
    rows sort together regardless of which source they came from.
  - The previous `(is_null, value)` tuple key + `reverse=True`
    floated null-date rows to the **top** in descending order.
    Switched to partitioning the list before sort: non-null rows
    sorted (then reversed for desc), null rows always appended at
    the end. Both directions now show real data first, then nulls.

  Verified empirically: asc → 2022-12-05 first; desc → 2026-05-01
  first, consistently.

## [2026-05-01] — OH Properties: per-column sort gating + actually-frozen header

### Fixed
- **Header row was still not freezing.** Earlier fix removed the
  outer overflow wrapper, but `borderCollapse: collapse` on the table
  itself prevents `position: sticky` on `<th>` from working in
  Chrome/Firefox (the borders are shared between `<th>` and `<td>`
  cells, which prevents independent positioning). Switched to
  `borderCollapse: separate` + `borderSpacing: 0`. Row separator
  borders moved from `<tr>` (don't render under `separate`) to
  `<td>` so the visual is unchanged. Header row now stays at top
  while body scrolls.

### Changed
- **Sortable columns are now an explicit per-column flag.** Only
  `City`, `BHK`, `Floor`, `Area (sqft)`, and `Date` are sortable.
  `Type`, `ID`, `Source`, `Society`, `Tower`, and `Unit` are
  display-only — no click cursor, no sort arrow, no orange highlight.

## [2026-05-01] — OH Properties: filters + column sort + frozen-header fix

### Added
- **Filter row** on the OH Properties page (sticky, just below the
  search row). Each filter affects the merged result set
  server-side:
  - **City** — dropdown, populated from current result facets
  - **Source** — dropdown, populated from facets
  - **BHK** — dropdown, populated from facets
  - **Floor** — text input (exact-text match, case/whitespace-insensitive)
  - **Area (sqft)** — `min`–`max` numeric range
  - **Date** — quick-pick chips `All / Yesterday / This Week / This Month / Custom`,
    plus an inline `from–to` date range that becomes editable when **Custom**
    is selected. Applies to `posting_date` (collated_data) and
    `schedule_submitted_at` (properties).
  - **Clear filters** button appears when any filter is set.

- **Sortable columns** — click any column header to sort the merged set
  ascending; click again to flip to descending. Active column is
  highlighted in orange. Server-side sort, so it spans all pages.
  Default = `date` desc.

### Changed
- The page header subtitle (`(collated · D Data · X · properties · F Data · Y)`)
  is removed — those counts already appear on the Both/D/F toggle in
  the search row.

### Fixed
- **Frozen header row was actually broken in the previous commit.** The
  table was wrapped in a `<div style="overflow-x: auto">`, which makes
  the div a scrolling ancestor for sticky purposes — so sticky `top`
  values inside resolve relative to that div, not the viewport. Removed
  the wrapper and applied `position: sticky` per-`<th>` (which works
  reliably across browsers, unlike `<thead>` sticky inside a scrolling
  parent). Page header / search row / filter row / column-headers now
  cascade properly:
  - page header @ `top: 0`     (z-index 30)
  - search row  @ `top: 56`    (z-index 25)
  - filter row  @ `top: 112`   (z-index 20)
  - column ths  @ `top: 172`   (z-index 10)

### Backend
- `GET /api/admin/external-inventory` accepts new query params:
  `source`, `bhk`, `floor`, `area_min`, `area_max`, `date_from`,
  `date_to`, `sort`, `direction`. Response now also includes
  `facets: {sources, cities, bhks}` (computed from the filtered
  result set, capped at 50–200 entries) and the active `sort` /
  `direction` echo.

## [2026-05-01] — OH Properties page polish (rename + frozen header row)

### Changed
- **Renamed user-facing label** to "**OH Properties**" (was briefly
  "External Data" / "OH Data" yesterday — final name). Applies to:
  - The toolbar button (`📂 OH Properties`)
  - The page header
  - README admin pages table

  The internal API path stays `/api/admin/external-inventory` and the
  React component file stays `ExternalInventory.jsx` for stability;
  only the user-visible text changed.

### Fixed
- **Frozen header row** — page header, filter row, and table column
  headers all stay visible as the table body scrolls. Implemented as a
  cascading sticky stack:
  - Page header at `top: 0` (z-index 30)
  - Filter row at `top: 56` (z-index 20)
  - Table column headers at `top: 112` (z-index 10)

  Sticky is applied per `<th>` rather than on `<thead>` because some
  browsers don't honor `position: sticky` on `<thead>` reliably when
  the table is inside a scrolling parent.

  Replaces yesterday's intermediate fix that just removed the sticky
  thead entirely (reverted).

## [2026-04-30] — External Data page (collated_data + properties viewer)

### Added
- **New admin "External Data" page.** Read-only merged view of inventory
  rows that are NOT in our `submissions` table:
  - `collated_data` (App DB; 99acres etc. scrape) — labelled **"D Data"**
  - `properties`    (Properties DB; the prod inventory pool) — labelled **"F Data"**

  **Entry point:** new `📂 External Data` button in the admin toolbar
  (staff only). Full-screen takeover of the admin board (returns via
  `← Back`); board state is preserved on return.

  **Backend** ([backend/routes/admin.py](backend/routes/admin.py)):
  - `GET /api/admin/external-inventory` (`@require_staff`).
  - Cross-DB merge in Python (can't UNION across `app` + `properties` at
    SQL level). Each side filtered server-side by `q` (substring match
    against society/locality/source) and `city` (case-insensitive exact)
    before merge, then sorted by date desc and paginated.
  - Hides `properties.is_dead = TRUE` rows.
  - Page size default 100, capped at 500. Returns `{results, total, page,
    page_size, counts:{D, F}}`.

  **Frontend:**
  - `api.adminListExternalInventory(filters)` helper.
  - New screen [`Admin/ExternalInventory.jsx`](frontend/src/screens/Admin/ExternalInventory.jsx)
    with search input (debounced 300ms), city dropdown, type toggle
    (Both / D Data / F Data), table with columns `Type · ID · Source ·
    Society/Locality · City · BHK · Floor · Tower · Unit · Area · Date`,
    and Prev/Next pagination.

  **Column mapping** (per user spec 2026-04-30):

  | Display | collated_data | properties |
  |---|---|---|
  | type | "D Data" | "F Data" |
  | id | `id` | `uid` |
  | source | `source` | `source` |
  | society | `society` | `society_name` |
  | city | `city` | `city` |
  | bhk | `bedrooms` | `configuration` |
  | floor | `floor` | `floor` |
  | tower | _(null)_ | `tower_no` |
  | unit_no | _(null)_ | `unit_no` |
  | area | `area_sqft` | `area_sqft` |
  | date | `posting_date` | `schedule_submitted_at` |

  **No schema change.**

## [2026-04-30] — Force-logout on expired/invalid token

### Fixed
- **"Token expired. Please log in again." used to leave the user
  stranded** on a half-loaded page. Now any 401 response on a request
  that included a JWT triggers an immediate session clear + page reload,
  so AuthContext re-mounts with no token and the user lands on Login.

  **Files:** [frontend/src/api.js](frontend/src/api.js) — added
  `forceLogoutOnExpiredToken()` (idempotent guard against multiple
  concurrent 401s), called from both `request()` and `downloadAdminCsv()`
  paths. Uses `window.location.replace(...)` so the broken page isn't
  in the back-button history.

  **Scope:** only applies to authenticated requests — login /
  send-otp / verify-otp etc. (which legitimately 401 on bad creds)
  are unaffected because they pass `auth: false` and our guard checks
  for the presence of a stored token.

  **No schema change.**

## [2026-04-30] — Per-listing RM override (vs CP-permanent reassign)

### Added
- **Per-listing RM override.** A new column
  `submissions.listing_rm_id` (FK → `rms`) lets an admin assign a single
  listing (or a batch) to a different RM **without** changing the CP's
  permanent RM. NULL = no override; effective RM falls back to
  `channel_partners.rm_id`.

  **Migration:** [`backend/migrations/2026-04-30-add-listing-rm-id.sql`](backend/migrations/2026-04-30-add-listing-rm-id.sql)
  — additive, idempotent (`ADD COLUMN IF NOT EXISTS`), with a partial
  index on non-NULL values. Must run on prod App DB before this code
  ships, per Convention #2.

  **Backend** ([backend/routes/admin.py](backend/routes/admin.py)):
  - `PATCH /api/admin/submissions/<id>/listing-rm` — single override.
    Body `{ target_rm_id: int|null }` (`null` clears).
  - `POST  /api/admin/submissions/bulk-reassign-listing-rm` — batch.
    Body `{ submission_ids: [int], target_rm_id: int|null }`. Cap 100.
  - Both `@require_admin_role`. Validate target RM exists + is_active.
    Each call seeds a `system` `submission_event` for audit.
  - Admin list (`GET /api/admin/submissions`) and single
    (`GET /api/admin/submissions/<id>`) responses now also include
    `listing_rm_id` and `listing_rm_name` (LEFT JOIN `rms`).

### Changed
- **`BulkReassignRmModal` now asks "what to reassign?" with a radio
  toggle** at the top (default: **These listings only**). User-requested
  on 2026-04-30: "ALWAYS ask whether the unit has to be reassigned or
  CP's RM has to be reassigned. By default, use unit to be reassigned."
  - **These listings only** (default) → calls the new
    `bulk-reassign-listing-rm` endpoint; sets
    `submissions.listing_rm_id` for the selected rows.
  - **Each CP's permanent RM** → existing behaviour
    (`/api/admin/cps/bulk-reassign-rm`); changes
    `channel_partners.rm_id`. Yellow "permanent change" warning still
    shown only when this mode is selected.
  - Per-mode selection table — listings mode lists each selected row
    (public_id, society/city, CP, current listing-RM); CP mode keeps
    the existing per-CP grouped table.
  - Submit-button label and success summary adapt to the chosen mode.

- **`DetailPanel` "CP's assigned RM"** section renamed to **"Assigned
  RM"** with the same radio toggle (default: **This listing only**).
  - The dropdown's `value` and `onChange` both react to the chosen
    scope: listing mode reads/writes `s.listing_rm_id` via
    `adminSetListingRm`; CP mode keeps the original
    `adminSetCpRm` path.
  - Helper text under the dropdown reflects the active scope ("Override
    for THIS listing only…" vs "Changes this CP's permanent RM…").
  - For non-admins (read-only view): if a listing override exists, the
    listing RM is shown with a small purple "(listing override)" tag;
    otherwise the CP's permanent RM name is shown as before.

### Notes
- The legacy `submissions.assigned_rm_id` column (FK to
  `channel_partners`, currently 0 rows) is intentionally left alone.
  Modern per-listing RM lives on the new `listing_rm_id` column FK'd
  at `rms`.
- Visual indicator on BoardView cards / TableView rows for "this
  listing has a listing-RM override" is **not** in this push — defer
  to a follow-up. Today the override is visible only inside the
  DetailPanel and (for non-admins) in its read-only label.
- The auto-syncer `_sync_visit_completed_from_properties` is unchanged
  and unaffected.

## [2026-04-30] — Stage reorder + auto-sync Visit Completed

### Changed
- **Pipeline stage display order.** In the admin board's stat cards and
  the kanban columns, `Visit Scheduled` and `Visit Completed` now appear
  **before** `Offer Given` (was: Offer Given → Visit Scheduled → Visit
  Completed). New left-to-right order:

  ```
  All · Unapproved · Submitted · Visit Scheduled · Visit Completed
       · Offer Given · Price Rejected · Duplicate Rejected
  ```

  Pure UI change in [`frontend/src/format.js`](frontend/src/format.js)
  `STAGES`. The underlying `status` values themselves are unchanged; no
  schema migration; no behavioural change in the dup-check / pipeline
  routing logic.

### Added
- **Auto-sync `Visit Completed` from `properties.visit_submitted_at`.**
  On every `GET /api/admin/submissions`, the backend now runs
  `_sync_visit_completed_from_properties()` before returning the list:
  1. Collect local submissions where `status='Visit Scheduled'` and
     `public_id` is non-NULL.
  2. Look up `properties.lead_id` matching those public_ids where
     `properties.visit_submitted_at IS NOT NULL`.
  3. `UPDATE submissions SET status='Visit Completed'` for matches and
     seed a `system` event in `submission_events` noting the source
     timestamp.

  Behaviour:
  - **Idempotent** — once a row reaches Visit Completed it's filtered
    out of the candidate set.
  - **Best-effort** — any error (cross-region timeout, properties DB
    unavailable) is caught and logged so the admin list still loads.
  - **Bounded by Visit Scheduled count** — typically <100 rows in prod;
    one cross-region read on Properties DB per admin board load.
  - Requires `submissions.public_id` to be set. Older imported scheduled
    rows that lack `public_id` are skipped (no harm). All new
    schedule-visit submissions set `public_id` automatically.

  **Files:** [backend/routes/admin.py](backend/routes/admin.py) (new
  helper + call from `list_submissions`).

  **Migration:** none.

  **Note:** This replaces the "Forms-app webhook" pull-mode approach
  proposed in the handover open issues. A real webhook is still
  preferable long-term (cheaper, real-time, no polling) — leaving that
  open as a future improvement.

## [2026-04-30] — Add README.md

### Added
- **`README.md`** at the repo root. Single-file orientation for the
  project: stack, local dev setup (with the macOS port-5000 / AirPlay
  caveat baked in), pipeline stages, role model, repo layout,
  conventions, deploy procedure, and known limitations. Doesn't replace
  the deeper HANDOVER doc — links to it. Will be kept in sync with each
  push that affects setup, conventions, or public surface.

## [2026-04-30] — On-behalf header fix + bulk-schedule per-row time

### Fixed
- **Add Inventory (on behalf) header was unreadable.** The screen reused
  the global `.header` class which paints a dark navy gradient with white
  text; my inline `background: '#fff'` overrode the gradient but left the
  white `← back` button and white title text invisible against the white
  background. Replaced with a custom light-mode header (dark text, bordered
  back button) so the back button is visible on the admin desktop view.

### Changed
- **Bulk Schedule Visit modal — per-row time** instead of one shared time
  at the top. Each selected listing now has its own time picker inline in
  the table; this lets RMs space out visits during the day in one batch
  rather than scheduling all listings at the same minute.
  - Top toolbar of the modal is now just `Date` + `Apply Field Executive
    to all rows`. Time has moved to a `Time` column on each row.
  - Column header `Field exec` renamed to `Field Executive` (full word).
  - Time inputs use the browser's native `<input type="time">`, which
    renders 12-hour with AM/PM in en-US locale.

  **Backend** ([backend/routes/admin.py](backend/routes/admin.py)):
  `POST /admin/submissions/bulk-schedule-visit` now accepts
  `items[i].schedule_time` (per-item). The top-level `schedule_time`
  remains as an optional fallback for items that omit it (back-compat).
  Per-item time is validated `HH:MM` 24-hr server-side and used when
  building the Forms-app payload AND when persisting `scheduled_time`
  on the submission row + system event.

### Notes
- Display formatting elsewhere is unchanged: `formatTime12` already
  renders stored 24-hr `HH:MM` as `1:30 PM` on the BoardView pill,
  TableView tooltip, and DetailPanel.
- No schema change.

## [2026-04-29] — Add Inventory on Behalf, RM filter, bulk-reassign RM

### Added
- **Add Inventory on behalf of a CP** (RM / Manager / Admin). New
  full-screen flow accessed via the **`+ Add Inventory`** button in the
  admin toolbar. The flow contains a sticky CP selector at the top
  (search by phone or name, scope-filtered: RM sees only their CPs,
  manager sees own + team, admin sees all) and reuses the existing
  AddUnit `Step1` form below. Photos remain optional.

  **Backend:**
  - `GET /api/admin/cps?q=<query>&limit=<n>` — scope-filtered CP search.
    Phone digits-only and name case-insensitive substring; up to 50
    results per call.
  - `POST /api/admin/submissions/on-behalf` — mirrors `POST /api/submissions`
    but with required `target_cp_id`. Validates the target CP is in the
    caller's scope, runs the same `check_duplicate` pipeline, and inserts
    the row with `cp_id = target_cp_id` and `submitted_by_name = <staff
    display name>`. Records a `submission_event` annotated "submitted by
    <staff> on behalf of CP <cp>".

  **Schema:**
  - `submissions.submitted_by_name TEXT NULL` (idempotent migration in
    [`backend/migrations/2026-04-29-add-submitted-by-name.sql`](backend/migrations/2026-04-29-add-submitted-by-name.sql)).
    `NULL` = CP submitted directly. Non-`NULL` = staff submitted on
    behalf, with the staff member's display name captured at submit
    time (denormalised so deletions don't break the audit trail).

  **Frontend:**
  - New components: [`Admin/AddInventoryOnBehalf.jsx`](frontend/src/screens/Admin/AddInventoryOnBehalf.jsx),
    [`Admin/CpSelector.jsx`](frontend/src/screens/Admin/CpSelector.jsx).
  - `AddUnit/Step1.jsx` accepts new `mode` and `targetCp` props (CP-side
    flow unchanged when `mode='cp'`, staff flow uses `mode='staff'`).
  - `BoardView`, `TableView`, `DetailPanel` show an orange `✏ via <name>`
    badge / annotation whenever `submitted_by_name` is set, with a full
    "Submitted by X on behalf of Y" tooltip.
  - Admin table rows changed from `vertical-align: middle` to
    `vertical-align: top` globally (rows now align consistently when a
    cell has multiple lines, e.g. the CP cell with its on-behalf badge).

- **RM filter on the admin board.** The collapsible **⚙ Filters** panel
  has a new **RM** dropdown alongside BHK and date range. Selecting an
  RM filters listings to those whose CP is assigned to that RM
  (`cp.rm_id = <id>` server-side). Clear-filters and active-count badge
  updated to include the RM filter.

  **Backend:** `_apply_filters()` accepts a new `rm_id` query param.

- **Bulk reassign RM** (admin only). New purple **`👤 Reassign RM…`**
  button in the bulk action bar, visible only when `is_admin=TRUE`.
  Opens a modal that:
  - Groups the selected listings by CP (so the admin sees the per-CP
    impact, with current RM and selection count).
  - Warns prominently that the change updates each CP's *permanent*
    `rm_id`, affecting **all** of their listings — not just the rows
    selected.
  - Lets the admin pick a target RM and submit; results are reported
    per-CP (✓ reassigned / ↺ already on this RM / ✗ not found).

  **Backend:** new endpoint `POST /api/admin/cps/bulk-reassign-rm`
  ([admin.py](backend/routes/admin.py)), gated `@require_admin_role`.
  Body `{ cp_ids: [int], target_rm_id: int }`; validates target RM is
  active, runs a single `UPDATE channel_partners SET rm_id = ... WHERE
  id = ANY(%s)` for all CPs that need a real change. Hard cap of 100
  CPs per request.

  **Frontend:** new component
  [`Admin/BulkReassignRmModal.jsx`](frontend/src/screens/Admin/BulkReassignRmModal.jsx)
  + `api.adminBulkReassignRm()` helper.

### Notes
- `+ Add Inventory` button is always visible to staff (RM / Manager /
  Admin), even when the caller has no CPs in scope. Clicking with no
  CPs in scope shows "No CPs match … in your scope." in the search
  dropdown.
- `Reassign RM` is admin-only; managers cannot move CPs between RMs in
  this push (can be loosened later if needed).
- The "Change CP" button in the on-behalf flow now preserves all typed
  unit details (BHK, floor, sqft, etc.). Only the targetCp pointer
  changes — city/society remain whatever the staff already entered.
- One follow-up known limitation, called out for the next round: the
  Q1=c design ("BoardView checkboxes restricted to Visit Scheduled
  column") was not implemented — selection works on all columns and
  the backend pre-flight catches genuinely invalid cases.

### Closed open issues at handover
- "Field exec dropdown not city-filtered" — **NOT closed** (separate
  schema change in `properties.users` required; out of scope here).
- "Bulk Schedule Visit not supported" — **closed in earlier push
  ([2026-04-29] Bulk schedule visits)**.

### Migration order (already applied to prod by the user)
1. `backend/migrations/2026-04-29-add-submitted-by-name.sql` ran on prod
   App DB before this code shipped, per Convention #2.

## [2026-04-29] — Schedule pill date/time formatting

### Fixed
- **Visit Scheduled pill on the admin board, table, and detail panel was
  showing raw HTTP-date and 24-hour time** — e.g.
  `📅 Thu, 30 Apr 2026 00:00:00 GMT · 13:30 · Test Sahaj`. The date came
  through as Flask's default `date` serialization (RFC 1123) and the time
  was displayed unconverted from its stored 24-hour form. Frontend now
  formats both:
  - Date → `30 Apr 2026` via new `formatDateOnly()` helper.
  - Time → `1:30 PM` via new `formatTime12()` helper.

  **Files:** [frontend/src/format.js](frontend/src/format.js) (added
  helpers), [frontend/src/screens/Admin/BoardView.jsx](frontend/src/screens/Admin/BoardView.jsx),
  [frontend/src/screens/Admin/TableView.jsx](frontend/src/screens/Admin/TableView.jsx),
  [frontend/src/screens/Admin/DetailPanel.jsx](frontend/src/screens/Admin/DetailPanel.jsx).

  **Migration:** none. Display-only fix; data is unchanged.

  **Verification:** Local Vite HMR; visually confirmed in BoardView card pill,
  TableView row tooltip, and DetailPanel scheduled section.

  **Note:** This is a frontend-only fix. Backend continues to serialize
  `scheduled_date` as HTTP-date; if other consumers depend on dates, a
  later cleanup can migrate the backend to ISO via a custom Flask JSON
  provider (not done in this push).

## [2026-04-29] — Bulk schedule visits

### Added
- **Bulk schedule visits.** New admin endpoint
  `POST /api/admin/submissions/bulk-schedule-visit` and a modal in the
  admin UI for scheduling visits across multiple submissions in one go.

  **How it works:** Admin enters bulk-select mode in the existing toolbar,
  ticks up to 20 listings, clicks the new "📅 Schedule visits…" button.
  The modal collects a shared date + time and a per-row field exec
  (with an "apply to all rows" picker for convenience). Submitting
  POSTs the batch to the new endpoint, which:
  1. Bulk-loads all submissions and field execs in two queries.
  2. Pre-validates every item locally — required fields, city whitelist,
     field exec authorization, CP name + 10-digit phone, sqft > 0,
     asking_price > 0. If ANY item fails pre-validation, the entire batch
     aborts with `400` + per-item errors. **No requests are sent to
     the Forms app.**
  3. If pre-flight passes, sequentially POSTs each item to the Forms
     app. A failure on one item does not abort the rest — per-row
     results are aggregated and returned.
  4. Rows already with `forms_uid` are skipped (no re-call) and
     reported as `already_existed=true`.
  5. Successful rows get a single batch UPDATE + submission_event INSERT.

  **Files:** [backend/routes/admin.py](backend/routes/admin.py),
  [frontend/src/api.js](frontend/src/api.js),
  [frontend/src/screens/Admin/index.jsx](frontend/src/screens/Admin/index.jsx),
  [frontend/src/screens/Admin/BulkScheduleVisitModal.jsx](frontend/src/screens/Admin/BulkScheduleVisitModal.jsx)
  (new).

  **Migration:** none. New endpoint, no schema change. Reuses the
  existing `forms_uid`/`scheduled_*`/`field_exec_name` columns added in
  the Apr 28 single-listing schedule-visit work.

  **Verification:** Local end-to-end against the App DB Neon branch with
  a mock Forms app stub on `:6000`. Green path (multiple rows scheduled
  with fake UIDs returned), idempotency (re-submitting a row marked
  `already_existed=true`), pre-flight error path (row missing required
  fields → entire batch aborts with red per-row errors), mixed-batch
  case (one valid + one already scheduled) — all confirmed.

  **Closes:** "Bulk Schedule Visit not supported" — open issue at handover.

### Notes
- Reuses the existing bulk-mode infrastructure shared between TableView
  and BoardView; no parallel selection state.
- Hard cap of 20 items per request, enforced server-side and surfaced
  in the UI by disabling the "Schedule visits…" button when more than
  20 are selected.
- Q1 of the design (BoardView checkbox restricted to "Visit Scheduled"
  column) was not implemented — selection works on all cards regardless
  of column. The yellow warning in the modal flags status mismatches,
  and backend pre-flight catches genuinely invalid cases.

## [2026-04-29] — Duplicate detection fix

### Fixed
- **Duplicate detection restored for numeric and text floors.** `_norm_floor()`
  previously coerced floor input to `int`, which silently broke `check_duplicate()`
  in two distinct ways:
  - **Numeric floors** (e.g. `"1"`, `"5"`) — int was bound to a `varchar = %s`
    SQL predicate, raising `UndefinedFunction: operator does not exist:
    character varying = integer`. The bare `except Exception` in
    `_check_submissions` swallowed the error and returned `False`, leaving
    `submissions_match=False`.
  - **Text floors** (e.g. `"Middle"`, `"Lower"`, `"Higher"`, `"Top"`,
    `"Ground"`, `"F1"`, `"B1"`) — `int()` raised `ValueError`, so `_norm_floor`
    returned `None`, and `check_duplicate()` exited early at the
    `floor_n is None` guard. No source (properties / submissions / collated)
    was ever queried.

  At time of fix, 492 of 738 active submissions (66%) on the App DB had text
  floors and had never been dup-checked. Numeric-floor submissions hit the
  type-error path. The bug had effectively disabled dup detection for the
  bulk of inventory.

  **Fix** ([backend/duplicate_check.py](backend/duplicate_check.py), commit
  `c2446f9`):
  - `_norm_floor` now returns a lowercase trimmed string (or `None` for
    empty/null input). Never returns int.
  - `_check_submissions` SQL predicate changed to
    `LOWER(TRIM(COALESCE(floor, ''))) = %s`.
  - `_check_collated_data` keeps its digits-only fuzzy match (collated is the
    soft signal) but now applies `REGEXP_REPLACE([^0-9])` symmetrically on
    both sides of the comparison.
  - `properties` `base_where` predicate changed to
    `LOWER(TRIM(COALESCE(floor::text, ''))) = %s` (`::text` cast is defensive
    in case `properties.floor` is INT).

  **Verification:** End-to-end against the App DB Neon branch with three
  scenarios — A) handover repro (DLF Camellias / 3BHK / floor `"1"`),
  B) text-floor cases (Gaur City 2 / 2BHK / `"Lower"`, Eros Sampoornam /
  2BHK / `"Middle"`, Supertech Cape Town / 2BHK / `"Middle"`), C) negative
  control returns no match.

  **Migration:** none. Existing rows are unchanged; only comparison logic
  changes.

  **Behavioural impact at deploy:** duplicates that previously slipped past
  dup-check will now flag. Expect a small spike in `Unapproved` cards in
  the days after deploy. Admin team should be informed.

  **Closes:** "submissions_match not triggering for unit-less duplicates" —
  the unresolved bug listed in the handover document.
