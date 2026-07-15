# Submissions — True "Select All" — Design Spec

**Date:** 2026-07-15
**Area:** `frontend/src/pages/Submissions.jsx`, `frontend/src/components/submissions/BulkBar.jsx`,
`backend/routes/admin.py`
**Status:** Approved design, pending implementation plan.

## 1. Goal & framing

Replace the BulkBar's **"Select all loaded (N)"** with a true **"Select all (5000 cap)"** that
captures *every row matching the current filter* — not just the rows that happen to be paginated
into memory — while still honouring any rows the user unticks afterwards.

Today "Select all loaded" is an honest name for a weak feature: the admin list endpoint paginates
per stage (15 default, 500 cap), so the button only ever reaches what's already been scrolled into
view. An admin filtering to **Offer Given (252)** cannot action those 252 in one gesture.

**This is not a label change.** Delivering it forces two backend changes, because the naive version
(select 252 → Apply) is rejected outright by a hard 200-ID cap, and lifting that cap alone would
trade a clean 400 for a timeout.

## 2. Decisions (approved)

| # | Decision | Choice |
|---|---|---|
| D1 | How to reach all matching rows | **Fetch rows, not ids** — `GET /admin/submissions?all=true` reusing the CSV export's existing unpaginated path. The backend cannot answer "what matches?" alone (§4). |
| D2 | 200-ID bulk cap | **Raise to 5000**, matching the list cap. |
| D3 | Making D2 safe | **Set-based rewrite** of `bulk-status` — the raised cap is unusable against the current per-row loop (§5). |
| D4 | Exclusions ("minus later unselected") | **Free** — `selectedIds` stays a plain `Set`; unticking removes. No exclusion-mode bookkeeping. |
| D5 | Cap visibility | Label reads **`Select all (5000 cap)`** always; a separate note fires only when the cap actually truncates (§7). |
| D6 | Other bulk caps | **Unchanged** — Schedule Visit 20, Reassign RM 100. External (Forms app) constraints, not ours. |

## 3. Scope

**In:** the `Select all` control, extracting the client-filter predicate (§6), `?all=true` on the
admin list endpoint, the `bulk-status` set-based rewrite + cap raise.

**Out:** Board/Table rendering, the filter UI itself, `bulk-schedule-visit`, `bulk-reassign-rm`,
CSV export, and any change to the stage machine.

## 4. Why fetch rows instead of an ids-only endpoint

The obvious design — "ask the backend for all matching ids" — **cannot work**, because the backend
does not know the filter.

| Filter | Applied where |
|---|---|
| `city`, `search`, `bhk`, `date_from/to`, `rm_id`, `cp_id` | server |
| **stage union** (multi-select), `matchTypes`, `missingInfo`, `priceMin/Max`, `ohPriceFilter`, `rejectReasons` | **client only** (`clientFilteredSubmissions`) |

The client-only refinements are derived from row fields the server never filters on, and the
`status` param takes a *single* stage while the UI offers a union. An ids-only endpoint would
return the wrong set whenever any refinement is active.

Fetching the rows and letting the existing `clientFilteredSubmissions` memo do the filtering gives
**exact parity with what the table renders, by construction** — the selection cannot drift from the
view, because both read the same memo. Side benefit: the table then genuinely shows every matching
row, so "loaded" stops being a weasel word.

## 5. Backend

### 5.1 `GET /api/admin/submissions?all=true`

A new query param on the existing route — not a new route, so all filter parsing is reused.
When `all=true`, dispatch to `_list_submissions_core(slim=True, limit_per_stage=None)`: the
already-existing unpaginated path (**cap `LIMIT 5000`**) that the CSV export has always used.
`limit`/`offset` are ignored in this mode. Response shape is unchanged (`submissions` + `counts`),
so the frontend reload path needs no new parsing.

### 5.2 `POST /api/admin/submissions/bulk-status` — set-based rewrite, cap 200 → 5000

**The problem:** the handler loops per row, issuing an `UPDATE` **and** an `INSERT` per submission —
~7,000 sequential round-trips for 3576 rows, inside one transaction, against gunicorn's **30s
default worker timeout**. Raising the cap without this rewrite converts a fast, clean 400 into a
slow, worker-killing timeout mid-transaction. **D2 is not safe without D3.**

Collapse the loop into two queries:

```sql
-- Q1: in-scope count, for the skipped / out_of_scope math
SELECT count(*) FROM submissions s
 WHERE s.id = ANY(%s) AND s.deleted_at IS NULL {scope_sql};

-- Q2: snapshot old status, update, and log events in one statement
WITH target AS (
  SELECT s.id, s.status AS old_status
    FROM submissions s
   WHERE s.id = ANY(%s)
     AND s.deleted_at IS NULL
     {scope_sql}
     AND s.status <> ALL(%s)                                   -- AUTO_ONLY_STAGES -> skipped
     AND (s.status IS DISTINCT FROM %s OR s.status_reason IS DISTINCT FROM %s)
   FOR UPDATE
), upd AS (
  UPDATE submissions SET status = %s, status_reason = %s
   WHERE id IN (SELECT id FROM target)
), ev AS (
  INSERT INTO submission_events
      (submission_id, actor_cp_id, actor_rm_id, kind, from_status, to_status, text)
  SELECT t.id, %s, %s, 'status_change', t.old_status, %s, 'Bulk action' FROM target t
)
SELECT count(*) AS updated FROM target;
```

The `target` CTE exists to **snapshot `old_status` before the update** — Postgres'
`UPDATE ... RETURNING` yields *new* values, so per-row `from_status` on the event row is otherwise
unrecoverable. `FOR UPDATE` preserves the row locking the loop got implicitly.

Response counts keep their current meanings:

- `updated` = `count(target)`
- `skipped` = `in_scope − updated` (auto-only stages + already-at-target)
- `out_of_scope` = `len(ids) − in_scope`

The single `log_activity` summary row is unchanged. Cap check becomes `len(ids) > 5000`.

## 6. Frontend

**Prerequisite refactor — extract the filter predicate.** The row-matching logic currently lives
*inside* the `clientFilteredSubmissions` memo. Lift its body to a standalone
`matchesClientFilters(row, filters)` and have the memo call it. Without this, `onSelectAll` has no
way to filter freshly-fetched rows (see below), and duplicating the predicate would let selection
and view drift apart — precisely the class of bug this whole feature is meant to close.

`BulkBar` swaps `Select all loaded ({submissions.length})` for `Select all (5000 cap)`, calling a
new `onSelectAll` supplied by `Submissions.jsx`, which:

1. Re-issues the current `effectiveFilters` with `all=true`.
2. `setSubmissions(rows)` and seed `loadedByStage` from the response, so load-more doesn't
   re-fetch rows already held.
3. Select **from `rows` directly**, via the shared predicate:
   `setSelectedIds(new Set(rows.filter(r => matchesClientFilters(r, filters)).map(r => r.id)))`.

**Step 3 must not read `clientFilteredSubmissions`.** It is a `useMemo`: it has not recomputed at
the point `onSelectAll` runs (React hasn't re-rendered yet), so it still holds the *pre-fetch* rows
— selecting from it would silently select the old page. Filtering `rows` through the same predicate
the memo uses keeps one source of truth while staying correct within the handler.

That shared predicate is the invariant: selection and view apply *the same* matching logic, so they
cannot disagree. The previous "363 selected vs 252 shown" bug was exactly this invariant broken —
selection read the raw, unfiltered `submissions` array while the views read the memo.

Button states:

| State | Shows |
|---|---|
| Idle | `Select all (5000 cap)` |
| Fetching | `Selecting…`, disabled |
| Done | `N selected` — the true matching count |
| Cap hit | `5000 selected` + `bulk-error`: **"capped at 5000 — N more match"** |

The existing filter-change effect still clears the selection; a selection must not outlive the
filter it was made under.

## 7. Error handling & edges

- **Cap truncation is never silent.** The label warns the cap *exists*; the note fires only when it
  *bit*, and says how many were missed. `5000 selected` must never read as "everything" on the day
  it isn't — that is the silent-cap failure mode, and the one that actually loses data. Detected by
  `rows.length === 5000 && counts.Total > 5000`.
- **Fetch failure** → surface in the bar's existing `bulk-error` span, leave the selection untouched.
- **Payload size:** 3576 ids ≈ 40 KB, far under the 110 MB body cap.
- **Today the cap is informational** — `counts.Total` is 3576, so nothing truncates until the table
  exceeds 5000 rows.
- **Schedule Visit past 20** stays blocked by the existing `overScheduleCap` guard.

## 8. Testing

- **Backend (pytest, `RUN_DB_TESTS=1`):** the set-based rewrite must reproduce the loop's counts.
  Cases: mixed batch (updatable + auto-only + already-at-target + out-of-scope + deleted) asserting
  `updated`/`skipped`/`out_of_scope`; `from_status` correctness on the emitted `submission_events`;
  `>5000` rejected; `Rejected` requires a valid `status_reason`; city-scope enforcement for managers.
- **Manual:** filter to Offer Given → `Select all` → count matches the 252 stat → untick 3 → Apply →
  249 updated. Then no filter → `Select all` → 3576 → Apply completes well within the 30s timeout.

## 9. Out of scope / follow-ups

- Server-side "apply to filter" (send criteria instead of ids) — the scalable end-state, but it
  requires teaching the backend every client-only refinement. Revisit past ~5000 rows.
- Chunked/resumable bulk writes — unnecessary once the write is 2 queries.
