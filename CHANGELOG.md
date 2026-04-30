# Changelog

All notable changes pushed to production are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Each entry corresponds to one production push (one or more bundled commits).

## [Unreleased]

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
