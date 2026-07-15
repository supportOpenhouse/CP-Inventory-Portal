# Home — Submissions Trend Line Graph — Design Spec

**Date:** 2026-07-15
**Area:** `backend/routes/admin.py`, `frontend/src/pages/Home.jsx`,
`frontend/src/components/home/SubmissionsTrend.jsx` (new), `frontend/src/api.js`
**Status:** Approved design.

## 1. Goal

Add a line graph of submissions per day, keyed on `submitted_at`, at the end of the **Summary**
section on the staff Home page. Answers one question: *is intake volume going up or down?*

## 2. Decisions (approved)

| # | Decision | Choice |
|---|---|---|
| D1 | Range | **Toggleable 30d / 90d**, styled like the existing `nsRange` "today / week" switch. |
| D2 | Granularity | **Daily for both ranges.** One endpoint shape, one code path, no bucketing. 90 points at full-card width sit ~11px apart and still read as a line; weekly would mean a second aggregation path for one view. |
| D3 | Series | **One line, all submissions.** The Pipeline card directly above already gives the by-stage breakdown; 9 overlapping lines on a card is unreadable. |
| D4 | Date basis | **`submitted_at`.** A day's count is a true historical record — it never rewrites itself, unlike a last-status-change basis where rows migrate between days. |
| D5 | Rendering | **Inline SVG `<polyline>`, no new dependency.** The bundle is already 2.4 MB; recharts (~500 KB) for one line is a bad trade. |
| D6 | Data source | **New aggregate endpoint.** Nothing groups by date today. The alternative — pulling all 3576 rows via `?all=true` and grouping client-side — puts ~1 MB on the Home page to draw one line. |

## 3. Scope

**In:** the aggregate endpoint, the `SubmissionsTrend` component, its placement in Home, one `api.js` method.

**Out:** tooltips beyond native `<title>`, gridlines, animation, per-stage series, export, drill-through.

## 4. Backend

### `GET /api/admin/submissions/by-date?days=30`

```json
{ "points": [ { "date": "2026-06-16", "count": 4 }, { "date": "2026-06-17", "count": 0 }, ... ] }
```

- `days` parsed as int, **clamped to `[1, 90]`** (matches D1's max; mirrors how `list_submissions`
  clamps `limit`). Non-numeric → default 30.
- One `GROUP BY (s.submitted_at AT TIME ZONE ...)::date` over non-deleted rows within the window.
- **Runs through `_scoped_city_filter`**, the same scoping every other count uses — a manager's
  trend must agree with the Pipeline and Outcomes cards directly above it.
- **Zero-fills every day in the window server-side.** SQL returns only days that have rows; without
  the fill the polyline joins across gaps and a quiet stretch renders as a smooth slope between two
  distant points — actively misleading, not merely incomplete. The fill happens in Python (the
  window is ≤90 items) rather than a `generate_series` join, to keep the SQL one plain aggregate.
- `@require_staff`, additive route — the frozen-API rule permits adding endpoints.

## 5. Frontend

### `components/home/SubmissionsTrend.jsx` (new file)

Its own module: `Home.jsx` is already 241 lines, and the SVG geometry is self-contained with one
clear input (`points`) — it can be understood and changed without reading Home.

- Full-width `.report-card` rendered **after** the `home-reports` grid, inside the Summary section.
- Header follows the existing `report-head` pattern: `<h3>Submissions</h3>` + a muted caption, with
  the 30d/90d toggle on the right.
- Fetches via `api.adminSubmissionsByDate(days)` on mount and on toggle.

### Chart construction

- Viewbox-based SVG, `preserveAspectRatio="none"` on the plot, so it scales to card width.
- y-domain `[0, max(counts)]`, floored at 1 so an all-zero window doesn't divide by zero.
- One `<polyline>` for the series; one `<line>` for the x-axis baseline.
- x labels: first and last date only (dense date ticks are unreadable at 90 points).
- y labels: `0` and `max`.
- Per-point `<title>` gives date + count on hover — native, free, accessible, no tooltip state.

### Theming (binding)

**No hardcoded hex.** Line/points `var(--brand)`, axis + labels `var(--border)` / `var(--text-muted)`,
fill tint via `color-mix(in srgb, var(--brand) …%, transparent)`. This screen shipped multiple
dark-mode defects today from hardcoded light hex; the chart must not add another.

### States

- **Loading:** reuse the `inv-skel` skeleton block already used by the Pipeline card.
- **Empty** (window has no submissions at all): explicit "No submissions in this range" message, not
  a flat line at zero — a flat line reads as a rendering bug.
- **Error:** the card renders the empty state; a failed trend must never break the Home page.

## 6. Testing

- **Backend (pytest, `RUN_DB_TESTS=1`):** window filtering (a row outside the range is excluded),
  zero-fill (a day with no rows returns `count: 0`, and `len(points) == days`), the `days` clamp
  (`days=500` → 90 points; `days=abc` → 30), and city scoping.
- **Frontend:** `npm run build`. The geometry helper (points → SVG path) is pure, so if it grows
  beyond a couple of lines it gets a `node:test` file alongside `clientFilters.test.js`.
- **Manual:** the trend's total over 90d should reconcile with the Outcomes card's total for the
  same window; toggling 30d/90d refetches and rescales.

## 7. Out of scope / follow-ups

- Caching: `api.js`'s GET cache already applies (`/` prefix → 30 min TTL). No extra work.
- If per-stage trends are ever wanted, that is a different card, not more lines on this one.
