# Submissions True "Select All" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the BulkBar's "Select all loaded (N)" with a true "Select all (5000 cap)" that selects every row matching the current filter, minus any the user unticks afterwards.

**Architecture:** The backend cannot answer "what matches?" — several filters are client-only — so "Select all" *fetches every matching row* via a new `?all=true` param (reusing the CSV export's existing unpaginated path) and filters them client-side through a predicate shared with the view. Acting on 3576 rows also requires `bulk-status` to stop looping per-row before its 200-ID cap can be raised to 5000.

**Tech Stack:** Flask + psycopg2 + Postgres (backend); React 18 + Vite (frontend); pytest (backend tests); `node:test` stdlib runner (frontend predicate tests — no new dependency).

**Spec:** `docs/superpowers/specs/2026-07-15-submissions-select-all-design.md`

## Global Constraints

- **Cap value is 5000** everywhere: the `LIMIT 5000` already in `_list_submissions_core`, the new `bulk-status` cap, and the button label. Never introduce a second number.
- **The HTTP API is frozen** — `?all=true` is an *additive optional param*; the response shape (`{submissions, counts}`) must not change. `bulk-status` request/response shapes must not change.
- **`bulk-status` response keys are exactly** `ok`, `updated`, `skipped_same_status`, `out_of_scope_or_deleted` — meanings preserved bit-for-bit.
- **`AUTO_ONLY_STAGES = {"Visit Scheduled", "Visit Completed", "Offer"}`** — rows in these stages are *skipped*, never updated.
- **`submissions.status` is nullable** (`VARCHAR(30) DEFAULT 'Submitted'`, no NOT NULL). Any `status <> ALL(...)` must be NULL-guarded or NULL-status rows change classification vs the current loop.
- **Do not touch** `bulk_schedule_visit` (cap 20) or `bulk_reassign_rm` (cap 100) — external Forms-app constraints.
- **Backend test command:** `cd backend && set -a && source ./.env && set +a && RUN_DB_TESTS=1 TEST_DATABASE_URL="$DATABASE_URL" ./venv/bin/pytest -q`

## File Structure

| File | Responsibility |
|---|---|
| `backend/routes/admin.py` (modify) | `list_submissions()` gains `?all=true`; `bulk_status()` rewritten set-based, cap 5000. |
| `backend/tests/test_select_all.py` (create) | DB-backed tests for both backend changes. Self-cleaning. |
| `frontend/src/components/submissions/clientFilters.js` (create) | `matchesClientFilters(row, filters)` — the single row-matching predicate. Plain `.js` (no JSX) so `node --test` can import it. |
| `frontend/src/components/submissions/clientFilters.test.js` (create) | `node:test` unit tests for the predicate. |
| `frontend/src/pages/Submissions.jsx` (modify) | Memo delegates to the predicate; adds `onSelectAll`. |
| `frontend/src/components/submissions/BulkBar.jsx` (modify) | "Select all loaded" → "Select all (5000 cap)" + truncation note. |
| `frontend/package.json` (modify) | Add `"test": "node --test src/"`. |

---

### Task 1: Backend — `?all=true` on the admin list endpoint

**Files:**
- Modify: `backend/routes/admin.py:1065-1083` (`list_submissions`)
- Test: `backend/tests/test_select_all.py` (create)

**Interfaces:**
- Consumes: existing `_list_submissions_core(slim, limit_per_stage, offset)`.
- Produces: `GET /api/admin/submissions?all=true` → `{submissions: [...], counts: {...}}` with every matching row (server cap 5000), ignoring `limit`/`offset`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_select_all.py`:

```python
"""Tests for `?all=true` (Select all) and the set-based bulk-status rewrite.

Rows are isolated by a unique society_name and found via the `search` param
(which does `s.society_name ILIKE %s`). Strictly self-cleaning: every row this
module creates is deleted in the fixture teardown, in reverse FK order.
"""
import os
import time

import psycopg2
import psycopg2.extras
import pytest

from tests.conftest import requires_db

_DSN = os.getenv("TEST_DATABASE_URL") or os.getenv("DATABASE_URL")


@pytest.fixture()
def many(graph):
    """Insert 20 'Submitted' submissions under the fixture CP, uniquely tagged."""
    conn = psycopg2.connect(_DSN, cursor_factory=psycopg2.extras.RealDictCursor)
    tag = f"pytest-all-{int(time.time() * 1000)}"
    ids = []
    try:
        with conn:
            with conn.cursor() as cur:
                for _ in range(20):
                    cur.execute(
                        "INSERT INTO submissions (cp_id, society_name, status) "
                        "VALUES (%s, %s, 'Submitted') RETURNING id",
                        (graph["cp"], tag),
                    )
                    ids.append(cur.fetchone()["id"])
        yield {"tag": tag, "ids": ids, "graph": graph}
    finally:
        with conn:
            with conn.cursor() as cur:
                # Reverse FK order: events reference submissions.
                cur.execute("DELETE FROM submission_events WHERE submission_id = ANY(%s)", (ids,))
                cur.execute("DELETE FROM submissions WHERE id = ANY(%s)", (ids,))
        conn.close()


@requires_db
def test_all_true_returns_every_matching_row(client, many):
    h = many["graph"]["headers"]["admin"]
    tag = many["tag"]

    paged = client.get(f"/api/admin/submissions?search={tag}&limit=5", headers=h)
    assert paged.status_code == 200
    assert len(paged.get_json()["submissions"]) == 5

    everything = client.get(f"/api/admin/submissions?all=true&search={tag}", headers=h)
    assert everything.status_code == 200
    assert len(everything.get_json()["submissions"]) == 20


@requires_db
def test_all_true_ignores_limit(client, many):
    h = many["graph"]["headers"]["admin"]
    r = client.get(f"/api/admin/submissions?all=true&limit=5&search={many['tag']}", headers=h)
    assert r.status_code == 200
    assert len(r.get_json()["submissions"]) == 20
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd backend && set -a && source ./.env && set +a && \
  RUN_DB_TESTS=1 TEST_DATABASE_URL="$DATABASE_URL" \
  ./venv/bin/pytest tests/test_select_all.py -q
```
Expected: FAIL — `all=true` is ignored, so both requests return 5 (or 15) rows, not 20.

- [ ] **Step 3: Write minimal implementation**

In `backend/routes/admin.py`, inside `list_submissions()`, replace the single `subs = ...` call (currently line 1083) with the `all` branch. Add the param parse just above the existing pagination block:

```python
    # `all=true` (BulkBar "Select all"): return every row matching the filters
    # instead of the per-stage page, so the client can select the whole result
    # set. Routes to the same unpaginated path the CSV export has always used
    # (LIMIT 5000 inside _list_submissions_core). `limit`/`offset` are ignored.
    select_all = request.args.get("all", "false").lower() == "true"

    # Pagination: default 15 per stage, capped at 500 for safety. Frontend
    # passes `offset` only when paginating a single stage (status filter is
    # set in the query string). Keeping the default small avoids fanning out
    # 7 large per-stage queries on the initial board load — that was the
    # source of intermittent gateway timeouts on popular cities.
    try:
        limit = int(request.args.get("limit", 15))
    except (TypeError, ValueError):
        limit = 15
    limit = max(1, min(limit, 500))
    try:
        offset = int(request.args.get("offset", 0))
    except (TypeError, ValueError):
        offset = 0
    offset = max(0, offset)

    # Slim payload: only the columns Board/Table cards (and bulk modals)
    # actually render. The side panel re-fetches the full row on click.
    if select_all:
        subs = _list_submissions_core(slim=True, limit_per_stage=None)
    else:
        subs = _list_submissions_core(slim=True, limit_per_stage=limit, offset=offset)
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd backend && set -a && source ./.env && set +a && \
  RUN_DB_TESTS=1 TEST_DATABASE_URL="$DATABASE_URL" \
  ./venv/bin/pytest tests/test_select_all.py -q
```
Expected: PASS (2 passed). Then run the full suite to confirm nothing regressed:
```bash
cd backend && set -a && source ./.env && set +a && \
  RUN_DB_TESTS=1 TEST_DATABASE_URL="$DATABASE_URL" ./venv/bin/pytest -q
```
Expected: all previously-passing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/admin.py backend/tests/test_select_all.py
git commit -m "feat(admin): add ?all=true to submissions list for Select all"
```

---

### Task 2: Backend — set-based `bulk-status` rewrite, cap 200 → 5000

**Files:**
- Modify: `backend/routes/admin.py:2833-2934` (`bulk_status`)
- Test: `backend/tests/test_select_all.py` (append)

**Interfaces:**
- Consumes: `_scoped_city_filter(cur)`, `AUTO_ONLY_STAGES`, `log_activity`.
- Produces: unchanged response `{"ok": True, "updated": int, "skipped_same_status": int, "out_of_scope_or_deleted": int}`; now accepts up to 5000 ids.

**Why:** the current handler issues an `UPDATE` **and** an `INSERT` per row — ~7,000 sequential round-trips for 3576 rows against gunicorn's 30s default worker timeout. Raising the cap without this rewrite turns a fast 400 into a timeout mid-transaction.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_select_all.py`:

```python
@requires_db
def test_bulk_status_counts_and_from_status(client, many):
    """Set-based rewrite must reproduce the old loop's counts exactly."""
    h = many["graph"]["headers"]["admin"]
    ids = many["ids"]
    conn = psycopg2.connect(_DSN, cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        with conn:
            with conn.cursor() as cur:
                # ids[0]: already at target -> skipped
                cur.execute("UPDATE submissions SET status='Closure' WHERE id=%s", (ids[0],))
                # ids[1]: AUTO_ONLY stage -> skipped
                cur.execute("UPDATE submissions SET status='Offer' WHERE id=%s", (ids[1],))
                # ids[2]: soft-deleted -> out of scope
                cur.execute("UPDATE submissions SET deleted_at=NOW() WHERE id=%s", (ids[2],))

        r = client.post("/api/admin/submissions/bulk-status",
                        json={"ids": ids + [99999999], "status": "Closure"}, headers=h)
        assert r.status_code == 200
        body = r.get_json()
        # 20 rows: 1 already-at-target + 1 auto-only = skipped 2; 1 deleted + 1
        # bogus id = out of scope 2; remaining 17 updated.
        assert body["updated"] == 17
        assert body["skipped_same_status"] == 2
        assert body["out_of_scope_or_deleted"] == 2

        with conn:
            with conn.cursor() as cur:
                cur.execute("SELECT status FROM submissions WHERE id=%s", (ids[1],))
                assert cur.fetchone()["status"] == "Offer"   # auto-only untouched
                # from_status must be the PRE-update value, not the new one.
                cur.execute(
                    "SELECT from_status, to_status FROM submission_events "
                    "WHERE submission_id=%s AND kind='status_change'", (ids[3],))
                ev = cur.fetchone()
                assert ev["from_status"] == "Submitted"
                assert ev["to_status"] == "Closure"
    finally:
        conn.close()


@requires_db
def test_bulk_status_rejects_over_5000(client, graph):
    r = client.post("/api/admin/submissions/bulk-status",
                    json={"ids": list(range(1, 5002)), "status": "Closure"},
                    headers=graph["headers"]["admin"])
    assert r.status_code == 400
    assert "5000" in r.get_json()["error"]


@requires_db
def test_bulk_status_accepts_over_200(client, many):
    """The old 200 cap must be gone."""
    r = client.post("/api/admin/submissions/bulk-status",
                    json={"ids": many["ids"] + list(range(900000, 900300)), "status": "Closure"},
                    headers=many["graph"]["headers"]["admin"])
    assert r.status_code == 200
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd backend && set -a && source ./.env && set +a && \
  RUN_DB_TESTS=1 TEST_DATABASE_URL="$DATABASE_URL" \
  ./venv/bin/pytest tests/test_select_all.py -q -k bulk_status
```
Expected: FAIL — `test_bulk_status_rejects_over_5000` gets the "Max 200" message, and `test_bulk_status_accepts_over_200` gets 400.

- [ ] **Step 3: Write the implementation**

In `backend/routes/admin.py`, change the cap check (currently line 2854):

```python
    if len(ids) > 5000:
        return jsonify({"error": "Max 5000 IDs per bulk operation"}), 400
```

Update the docstring line `Max 200 IDs per call.` → `Max 5000 IDs per call.`

Then replace the whole `conn = get_app_conn()` block (currently lines 2880-2927) with:

```python
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            scope_sql, scope_params = _scoped_city_filter(cur)

            # Q1: in-scope ids (exists, not deleted, within the caller's city
            # scope). Drives the skipped / out_of_scope arithmetic below —
            # same meanings the per-row loop produced.
            cur.execute(f"""
                SELECT s.id FROM submissions s
                WHERE s.id = ANY(%s)
                  AND s.deleted_at IS NULL
                  {scope_sql}
            """, [clean_ids, *scope_params])
            in_scope_ids = [r["id"] for r in cur.fetchall()]

            # Q2: snapshot, update, and log every row in ONE statement. This
            # replaced a per-row loop (1 UPDATE + 1 INSERT each) that could not
            # survive the 30s worker timeout at 5000 ids.
            #
            # `target` must read status BEFORE the UPDATE: Postgres'
            # UPDATE ... RETURNING yields the NEW value, which would make
            # from_status wrong on every event row.
            #
            # The `s.status IS NULL OR` guard matters: submissions.status is
            # nullable, and `NULL <> ALL(...)` is NULL (row dropped), which
            # would silently reclassify NULL-status rows as skipped — the loop
            # updated them.
            cur.execute(f"""
                WITH target AS (
                    SELECT s.id, s.status AS old_status
                      FROM submissions s
                     WHERE s.id = ANY(%s)
                       AND s.deleted_at IS NULL
                       {scope_sql}
                       AND (s.status IS NULL OR s.status <> ALL(%s))
                       AND (s.status IS DISTINCT FROM %s
                            OR s.status_reason IS DISTINCT FROM %s)
                       FOR UPDATE
                ), upd AS (
                    UPDATE submissions SET status = %s, status_reason = %s
                     WHERE id IN (SELECT id FROM target)
                ), ev AS (
                    INSERT INTO submission_events
                        (submission_id, actor_cp_id, actor_rm_id, kind,
                         from_status, to_status, text)
                    SELECT t.id, %s, %s, 'status_change', t.old_status, %s, 'Bulk action'
                      FROM target t
                )
                SELECT count(*) AS updated FROM target
            """, [
                clean_ids, *scope_params, list(AUTO_ONLY_STAGES),
                new_status, new_reason,
                new_status, new_reason,
                g.user.get("cp_id"), g.user.get("rm_id"), new_status,
            ])
            updated = cur.fetchone()["updated"]

            skipped = len(in_scope_ids) - updated
            out_of_scope = len(clean_ids) - len(in_scope_ids)

            log_activity(
                cur, action="status_change_bulk", category="submission",
                entity_type="submission_bulk",
                details={
                    "to": new_status,
                    "updated": updated,
                    "skipped_same_status": skipped,
                    "out_of_scope_or_deleted": out_of_scope,
                    "ids": in_scope_ids[:50],
                },
            )
            conn.commit()
    finally:
        put_app_conn(conn)

    return jsonify({
        "ok": True,
        "updated": updated,
        "skipped_same_status": skipped,
        "out_of_scope_or_deleted": out_of_scope,
    }), 200
```

Delete the now-unused `updated, skipped = 0, 0` initialiser above the `try`.

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd backend && set -a && source ./.env && set +a && \
  RUN_DB_TESTS=1 TEST_DATABASE_URL="$DATABASE_URL" \
  ./venv/bin/pytest tests/test_select_all.py -q
```
Expected: PASS (5 passed). Then the full suite:
```bash
cd backend && set -a && source ./.env && set +a && \
  RUN_DB_TESTS=1 TEST_DATABASE_URL="$DATABASE_URL" ./venv/bin/pytest -q
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/admin.py backend/tests/test_select_all.py
git commit -m "perf(admin): rewrite bulk-status set-based, raise cap 200 -> 5000"
```

---

### Task 3: Frontend — extract the `matchesClientFilters` predicate

**Files:**
- Create: `frontend/src/components/submissions/clientFilters.js`
- Create: `frontend/src/components/submissions/clientFilters.test.js`
- Modify: `frontend/src/pages/Submissions.jsx:146-189` (the `clientFilteredSubmissions` memo)
- Modify: `frontend/package.json` (add `test` script)

**Interfaces:**
- Produces: `matchesClientFilters(row, filters) -> boolean`, where `filters` is
  `{statusFilter: string[], matchTypes: string[], missingInfo: string[], priceMin: string, priceMax: string, ohPriceFilter: string, rejectReasons: string[]}`.
  Task 4 consumes both this and the `clientFilters` memo object.

**Why:** Task 4's `onSelectAll` cannot read `clientFilteredSubmissions` — it's a `useMemo` that has not recomputed when the handler runs, so it still holds pre-fetch rows. Both paths must share ONE predicate, or selection and view drift apart (the "363 selected over a 252 filter" bug).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/submissions/clientFilters.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { matchesClientFilters } from './clientFilters.js';

const NONE = {
  statusFilter: [], matchTypes: [], missingInfo: [],
  priceMin: '', priceMax: '', ohPriceFilter: '', rejectReasons: [],
};
const row = (over = {}) => ({ status: 'Submitted', asking_price: 100, seller_name: 'S', ...over });

test('no filters: everything matches', () => {
  assert.equal(matchesClientFilters(row(), NONE), true);
});

test('stage filter is a union, not a single stage', () => {
  const f = { ...NONE, statusFilter: ['Offer', 'Closure'] };
  assert.equal(matchesClientFilters(row({ status: 'Offer' }), f), true);
  assert.equal(matchesClientFilters(row({ status: 'Closure' }), f), true);
  assert.equal(matchesClientFilters(row({ status: 'Rejected' }), f), false);
});

test('matchTypes ORs the flags', () => {
  const f = { ...NONE, matchTypes: ['perfect', 'weak'] };
  assert.equal(matchesClientFilters(row({ perfect_match_at_submit: true }), f), true);
  assert.equal(matchesClientFilters(row({ weak_match: true }), f), true);
  assert.equal(matchesClientFilters(row({ collated_match: true }), f), false);
});

test('missingInfo matches absent fields', () => {
  const f = { ...NONE, missingInfo: ['no_asking_price'] };
  assert.equal(matchesClientFilters(row({ asking_price: null }), f), true);
  assert.equal(matchesClientFilters(row({ asking_price: 100 }), f), false);
});

test('price bounds are inclusive', () => {
  assert.equal(matchesClientFilters(row({ asking_price: 100 }), { ...NONE, priceMin: '100' }), true);
  assert.equal(matchesClientFilters(row({ asking_price: 99 }), { ...NONE, priceMin: '100' }), false);
  assert.equal(matchesClientFilters(row({ asking_price: 100 }), { ...NONE, priceMax: '100' }), true);
  assert.equal(matchesClientFilters(row({ asking_price: 101 }), { ...NONE, priceMax: '100' }), false);
});

test('ohPriceFilter has/check', () => {
  assert.equal(matchesClientFilters(row({ oh_state: 'match' }), { ...NONE, ohPriceFilter: 'has' }), true);
  assert.equal(matchesClientFilters(row({ oh_state: 'diff' }), { ...NONE, ohPriceFilter: 'has' }), false);
  assert.equal(matchesClientFilters(row({ oh_state: 'diff' }), { ...NONE, ohPriceFilter: 'check' }), true);
  assert.equal(matchesClientFilters(row({ oh_state: 'match' }), { ...NONE, ohPriceFilter: 'check' }), false);
});

test('rejectReasons matches status_reason', () => {
  const f = { ...NONE, rejectReasons: ['Hold'] };
  assert.equal(matchesClientFilters(row({ status_reason: 'Hold' }), f), true);
  assert.equal(matchesClientFilters(row({ status_reason: 'Duplicacy' }), f), false);
});

test('filters AND together', () => {
  const f = { ...NONE, statusFilter: ['Offer'], priceMin: '50' };
  assert.equal(matchesClientFilters(row({ status: 'Offer', asking_price: 60 }), f), true);
  assert.equal(matchesClientFilters(row({ status: 'Offer', asking_price: 10 }), f), false);
  assert.equal(matchesClientFilters(row({ status: 'Rejected', asking_price: 60 }), f), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Add the script to `frontend/package.json` first, in the `"scripts"` block:

```json
    "test": "node --test src/"
```

Run:
```bash
cd frontend && npm test
```
Expected: FAIL — `Cannot find module .../clientFilters.js`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/components/submissions/clientFilters.js`:

```js
/**
 * The row-matching predicate for the Submissions client-only filters.
 *
 * Lives outside the component so BOTH the `clientFilteredSubmissions` memo (what
 * the Board/Table render) and the "Select all" handler (which must filter rows
 * it just fetched, before the memo has recomputed) run the SAME logic. Two
 * copies would let the selection and the table drift apart — that is exactly the
 * bug that showed "363 selected" under a 252-row filter.
 *
 * Plain .js, no JSX: `node --test` imports it directly (see clientFilters.test.js).
 */
export function matchesClientFilters(s, f) {
  const {
    statusFilter = [], matchTypes = [], missingInfo = [],
    priceMin = '', priceMax = '', ohPriceFilter = '', rejectReasons = [],
  } = f;

  // Stage filter is client-side (multi-select union) — the backend `status`
  // param only takes a single stage, so we post-filter instead.
  if (statusFilter.length > 0 && !statusFilter.includes(s.status)) return false;

  if (matchTypes.length > 0) {
    const flags = {
      perfect: s.perfect_match_at_submit === true,
      collated: s.collated_match === true,
      submissions: s.submissions_match === true,
      weak: s.weak_match === true,
    };
    if (!matchTypes.some((t) => flags[t])) return false;
  }

  if (missingInfo.length > 0) {
    const flags = {
      no_asking_price: !s.asking_price,
      no_seller: !s.seller_name,
    };
    if (!missingInfo.some((t) => flags[t])) return false;
  }

  if (priceMin !== '' && (Number(s.asking_price) || 0) < Number(priceMin)) return false;
  if (priceMax !== '' && (Number(s.asking_price) || 0) > Number(priceMax)) return false;

  if (ohPriceFilter) {
    const state = s.oh_state;
    if (ohPriceFilter === 'has' && state !== 'match') return false;
    if (ohPriceFilter === 'check' && !(state && state !== 'match')) return false;
  }

  if (rejectReasons.length > 0 && !rejectReasons.includes(s.status_reason)) return false;

  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd frontend && npm test
```
Expected: PASS (8 tests).

- [ ] **Step 5: Point the memo at the predicate**

In `frontend/src/pages/Submissions.jsx`, add the import beside the other submissions-component imports:

```js
import { matchesClientFilters } from '../components/submissions/clientFilters.js';
```

Replace the entire `clientFilteredSubmissions` memo (currently lines 146-189) with:

```js
  // The client-only filter values, bundled once so both the memo below and
  // onSelectAll (Task 4) feed the SAME object to the SAME predicate.
  const clientFilters = useMemo(() => ({
    statusFilter, matchTypes, missingInfo, priceMin, priceMax, ohPriceFilter, rejectReasons,
  }), [statusFilter, matchTypes, missingInfo, priceMin, priceMax, ohPriceFilter, rejectReasons]);

  // Post-filter the loaded rows for the client-only refinements above. Runs
  // after every server reload/load-more, over whatever's currently in
  // `submissions` — cheap, since it's at most a few thousand rows in memory.
  const clientFilteredSubmissions = useMemo(() => {
    if (clientFilterCount === 0 && statusFilter.length === 0) return submissions;
    return submissions.filter((s) => matchesClientFilters(s, clientFilters));
  }, [submissions, clientFilterCount, statusFilter, clientFilters]);
```

- [ ] **Step 6: Verify the build and the filters still work**

Run:
```bash
cd frontend && npm test && npm run build
```
Expected: 8 tests pass; `✓ built`.

Manual: `npm run dev` → Submissions → click each stat card and confirm the row counts match the card numbers, then apply a price range and a reject-reason filter and confirm rows narrow as before. Behaviour must be identical — this step is a pure refactor.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/submissions/clientFilters.js \
        frontend/src/components/submissions/clientFilters.test.js \
        frontend/src/pages/Submissions.jsx frontend/package.json
git commit -m "refactor(submissions): extract matchesClientFilters predicate + tests"
```

---

### Task 4: Frontend — the "Select all (5000 cap)" control

**Files:**
- Modify: `frontend/src/pages/Submissions.jsx` (add `onSelectAll`; update the `<BulkBar>` props)
- Modify: `frontend/src/components/submissions/BulkBar.jsx` (replace the select-all button; add the note)

**Interfaces:**
- Consumes: `matchesClientFilters` + the `clientFilters` memo (Task 3); `?all=true` (Task 1).
- Produces: `BulkBar` props `onSelectAll: () => Promise<void>`, `selectingAll: boolean`, `selectAllNote: string`, `selectAllCap: number`. The `setSelectedIds` prop is removed.

- [ ] **Step 1: Add the handler in `Submissions.jsx`**

Add the cap constant beside the other module constants at the top of the file:

```js
// Server tops out at LIMIT 5000 in _list_submissions_core — the same number the
// bulk-status cap uses. One source of truth; the label renders from it.
const SELECT_ALL_CAP = 5000;
```

Add the state beside the other bulk state (near `selectedIds`):

```js
  const [selectingAll, setSelectingAll] = useState(false);
  const [selectAllNote, setSelectAllNote] = useState('');
```

Add the handler immediately after the `clientFilteredSubmissions` memo (it must sit below `clientFilters`):

```js
  // "Select all": fetch EVERY row matching the server filters, then select the
  // ones that also pass the client-only refinements.
  //
  // It filters `rows` directly rather than reading `clientFilteredSubmissions`:
  // that memo has not recomputed yet at this point in the handler, so it still
  // holds the pre-fetch page — selecting from it would silently select the old
  // rows. Same predicate, so selection and view cannot disagree.
  const onSelectAll = useCallback(async () => {
    setSelectingAll(true);
    setSelectAllNote('');
    try {
      const data = await api.adminListSubmissions({ ...effectiveFilters, all: 'true' });
      const rows = data.submissions || [];
      setSubmissions(rows);
      if (data.counts) setCounts(data.counts);
      const loaded = {};
      for (const s of rows) loaded[s.status] = (loaded[s.status] || 0) + 1;
      setLoadedByStage(loaded);
      setLoadingByStage({});
      setSelectedIds(new Set(
        rows.filter((s) => matchesClientFilters(s, clientFilters)).map((s) => s.id),
      ));
      // No silent caps: the server stops at 5000 rows. Say so when it actually
      // bit — "5000 selected" must never read as "everything" when it isn't.
      const total = data.counts?.Total ?? 0;
      if (rows.length >= SELECT_ALL_CAP && total > SELECT_ALL_CAP) {
        setSelectAllNote(`capped at ${SELECT_ALL_CAP} — ${total - SELECT_ALL_CAP} more match`);
      }
    } catch (err) {
      setSelectAllNote(err.message || 'Select all failed');
    } finally {
      setSelectingAll(false);
    }
  }, [effectiveFilters, clientFilters]);
```

- [ ] **Step 2: Rewire the `<BulkBar>` props**

In the same file, replace the `setSelectedIds={setSelectedIds}` line in the `<BulkBar>` element with:

```jsx
        onSelectAll={onSelectAll}
        selectingAll={selectingAll}
        selectAllNote={selectAllNote}
        selectAllCap={SELECT_ALL_CAP}
```

- [ ] **Step 3: Replace the button in `BulkBar.jsx`**

Update the props signature — drop `setSelectedIds`, add the four new ones:

```js
export default function BulkBar({
  bulkMode,
  selectedIds,
  submissions = [],
  onSelectAll,
  selectingAll = false,
  selectAllNote = '',
  selectAllCap = 5000,
  onClearSelection,
  onExitBulkMode,
  onChanged,
  canReassign = false,
}) {
```

`canReassign` is the only capability prop this component takes — do not add others. `submissions` stays: the `selectedSubmissions` memo still needs it to hand rows to the two modals.

Delete the now-dead `selectAllLoaded` function:

```js
  function selectAllLoaded() {
    setSelectedIds?.(new Set(submissions.map((s) => s.id)));
  }
```

Replace the whole `{setSelectedIds && (...)}` button block with:

```jsx
        {onSelectAll && (
          <button
            type="button"
            className="btn-link"
            onClick={onSelectAll}
            disabled={submitting || selectingAll}
            title={`Selects every row matching the current filters (server cap: ${selectAllCap})`}
          >
            {selectingAll ? 'Selecting…' : `Select all (${selectAllCap} cap)`}
          </button>
        )}
        {selectAllNote && <span className="bulk-error">{selectAllNote}</span>}
```

Finally, update the "Select all matching" paragraph in the file's header docstring — it currently documents the old loaded-only behaviour and is now wrong:

```
 * "Select all": `GET /admin/submissions?all=true` returns every row matching the
 * current server filters (capped at 5000 by _list_submissions_core); the page
 * then selects those that also pass the client-only refinements, using the same
 * `matchesClientFilters` predicate the Board/Table render through. Rows the user
 * unticks afterwards simply leave `selectedIds`. If the 5000 cap truncates, the
 * page passes a `selectAllNote` and we render it — never a silent cap.
```

- [ ] **Step 4: Verify the build**

Run:
```bash
cd frontend && npm run build
```
Expected: `✓ built`.

- [ ] **Step 5: Verify end-to-end manually**

With the backend running (`cd backend && ./venv/bin/python app.py`) and `npm run dev`:

1. Submissions → **Table** → enter select mode. The bar shows `Select all (5000 cap)` at "0 selected".
2. Click the **Offer Given** stat card, then **Select all** → the count must equal the card's number (252 on prod data). *This is the bug this feature closes — it must never exceed the card.*
3. Untick 3 rows → count drops by exactly 3 ("minus the later unselected").
4. Choose **Change Stage → Closure** → Apply → succeeds. Previously >200 returned "Max 200 IDs per bulk operation".
5. Clear the filter → **Select all** → 3576 selected → Apply completes well inside the 30s worker timeout.
6. Change a filter mid-selection → selection clears, bar **stays** at "0 selected", Apply disabled.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Submissions.jsx frontend/src/components/submissions/BulkBar.jsx
git commit -m "feat(submissions): true Select all with 5000 cap + truncation note"
```
