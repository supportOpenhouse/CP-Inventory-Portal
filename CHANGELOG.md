# Changelog

All notable changes pushed to production are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Each entry corresponds to one production push (one or more bundled commits).

## [Unreleased]

## [2026-04-29]

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
