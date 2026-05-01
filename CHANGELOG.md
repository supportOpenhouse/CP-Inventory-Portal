# Changelog

All notable changes pushed to production are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Each entry corresponds to one production push (one or more bundled commits).

## [Unreleased]

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
