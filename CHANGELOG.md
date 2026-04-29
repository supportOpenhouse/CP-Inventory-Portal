# Changelog

All notable changes pushed to production are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Each entry corresponds to one production push (one or more bundled commits).

## [Unreleased]

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
