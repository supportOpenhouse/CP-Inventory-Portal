# P3 — Submissions Page (Board ⇄ Table + Expand + Filter + Bulk) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is a **port-and-wire** plan: most tasks port an existing component and rewire it; complete code is given for new glue, and each port task names its exact source file.

**Goal:** Build the Submissions page — a board ⇄ table toggle over CP's submissions, with Direct-style row-expand, a detailed filter modal, and a floating bulk-action bar — preserving 100% of CP's board/table/detail logic while adopting Direct's look and interaction patterns.

**Architecture:** Port CP's `Admin/index.jsx` data/pagination/filter/bulk orchestration into `pages/Submissions.jsx` (dropping the subview toggles that are now separate router pages — OH Properties, Activity Log, Admin Panel, WhatsApp). Refactor CP's 1471-line `DetailPanel.jsx` into reusable **section components** (`submissionDetail/*`) that compose into both Direct's inline `ExpandPanel` (table) and a `CardDetailModal` (board). Board view ports CP's `BoardView`; table view ports Direct's `InventoryTable` with CP columns. The filter modal ports Direct's `FilterPanel` mapped to CP's filter params.

**Tech Stack:** React 18, react-router (already in P2), CP `api.js` (P2), `format.js` STAGES/formatters (P2).

## Global Constraints

- **Preserve CP logic exactly.** Status change, counter-offer, schedule-visit (Forms pre-flight), listing-RM reassign (scope radio), notes, media upload/remove, match badges, on-behalf add, per-stage lazy pagination, viewer read-only — all behave as in CP today. Only presentation + layout change.
- **Endpoints:** use the existing `api.*` methods only (`adminListSubmissions`, `adminGetSubmission`, `adminChangeStatus`, `adminSendCounterOffer`, `adminAddComment`, `adminUpdateSubmission`, `adminScheduleVisit`, `adminBulkScheduleVisit`, `adminBulkStatus`, `adminSetListingRm`, `adminBulkReassignListingRm`, `adminListRms`, `adminListFieldExecs`, `adminListPropertiesBySociety`, `downloadAdminCsv`). No new endpoints.
- **Filter param keys** passed to `adminListSubmissions` are CP's existing ones: `city`, `search`, `bhk`, `date_from`, `date_to`, `rm_id` (from `rmFilter`), `status` (from `statusFilter`, table view only), `limit`, `offset`/`skip_counts`. Do not invent params — match CP's `index.jsx` wire format.
- **Stage model** from `format.js`: `STAGES`, `AUTO_ONLY_STAGES`, `REJECTED_REASONS` — unchanged. Board columns/table stages iterate `STAGES`; viewer sees `adminOnly` stages too.
- **Viewer read-only:** `isStaff = role ∈ {admin,manager,rm}`; viewers see everything but no action controls render (existing gate).

## File Structure

`frontend/src/` (new/replaced):
- `pages/Submissions.jsx` — page shell: toolbar, data load, pagination, view toggle, bulk orchestration (ports `Admin/index.jsx`)
- `components/submissions/BoardView.jsx` — kanban (ports CP `Admin/BoardView.jsx`, retokened)
- `components/submissions/TableView.jsx` — sticky sortable table + row-expand (ports Direct `InventoryTable.jsx` + `ExpandPanel.jsx`, CP columns)
- `components/submissions/ExpandPanel.jsx` — the inline expanded-row detail (Direct pattern, CP sections)
- `components/submissions/CardDetailModal.jsx` — wide modal for board-card clicks (embeds the same sections)
- `components/submissions/FilterModal.jsx` — detailed filter modal (ports Direct `FilterPanel.jsx`, CP fields)
- `components/submissions/BulkBar.jsx` — floating bulk-action bar (ports Direct `BulkActionBar.jsx`, CP actions)
- `components/submissions/detail/` — section components extracted from CP `DetailPanel.jsx`:
  `StatusSection.jsx`, `CounterOfferSection.jsx`, `ScheduleVisitSection.jsx`, `ReassignRmSection.jsx`, `PricingSection.jsx`, `PeopleSection.jsx`, `NotesSection.jsx`, `MediaSection.jsx`, `UnitDetailsSection.jsx`, `EditFieldsSection.jsx`
- `components/MatchDetailsModal.jsx`, `components/ConfirmDialog.jsx`, `components/Skeleton.jsx` — copied from CP (used by detail/board)
- Reference sources: CP `Admin/{index,BoardView,TableView,DetailPanel,MatchDetailsModal}.jsx`; Direct `components/{InventoryBoard,InventoryTable,ExpandPanel,FilterPanel,BulkActionBar}.jsx`

---

## Task 1: Extract CP DetailPanel into reusable section components

Refactor first so board + table + modal can all compose the same interactive sections (DRY — the actions live in one place).

**Files:**
- Create: `frontend/src/components/submissions/detail/*.jsx` (10 sections listed above), `frontend/src/components/{MatchDetailsModal,ConfirmDialog,Skeleton}.jsx`
- Reference: CP `screens/Admin/DetailPanel.jsx` (1471 lines — the source of every section)

**Interfaces:**
- Each section is `function XSection({ submission, canAct, onChanged })` where `submission` is the `adminGetSubmission(id)` shape, `canAct = isStaff && !viewer`, and `onChanged(updated)` bubbles a refetched/patched submission up to the host. Sections call the same `api.*` methods CP's DetailPanel calls today.
- Produces: importable sections for Tasks 3–4.

- [ ] **Step 1: Copy leaf components CP detail depends on**

```bash
CP="/Users/oh-sahaj/Documents/GitHub/CP-Inventory-Portal/frontend/src"
cp "$CP/components/MatchDetailsModal.jsx" frontend/src/components/MatchDetailsModal.jsx
cp "$CP/components/ConfirmDialog.jsx" frontend/src/components/ConfirmDialog.jsx
cp "$CP/components/Skeleton.jsx" frontend/src/components/Skeleton.jsx
```

- [ ] **Step 2: Extract each section from `DetailPanel.jsx`**

For each section file, lift the corresponding block from CP `DetailPanel.jsx` (see the map below) into a standalone component with the `{ submission, canAct, onChanged }` signature, replacing inline styles with token classes (`.field-lbl/.field-val`, `.expand-sec`, `.btn-*`, `.pill`, `.stage-dot`). **Keep every API call, guard, and state machine identical.**

| Section file | Lifts from DetailPanel | Behavior to preserve |
|---|---|---|
| `UnitDetailsSection` | Unit details grid | BHK/Area/Floor/Tower/Unit/Occupancy read-only display |
| `PricingSection` | Pricing block | Asking (orange), OH Price (`formatOhPrice`), Rate/sqft |
| `CounterOfferSection` | Counter-offer block | tally, pending/accepted/rejected/broker states, `adminSendCounterOffer` (lakhs), show-when rules |
| `ScheduleVisitSection` | `ScheduleVisitSection` nested comp | Forms pre-flight (`adminListPropertiesBySociety` warning table), `adminListFieldExecs`, `adminScheduleVisit`, auto-promote |
| `StatusSection` | Status `<select>` | STAGES options, AUTO_ONLY disabled, Rejected→`REJECTED_REASONS`, `adminChangeStatus`; read-only label for viewers/auto rows |
| `ReassignRmSection` | Assigned RM block | admin/manager scope radio (this listing / + society mapping), `adminSetListingRm`; RM read-only effective RM |
| `PeopleSection` | People block | CP link (→ open CP history, via `onOpenCpHistory` prop), cp_code/phone, seller name/phone missing-flag |
| `NotesSection` | Notes block | comment events list + add-note (`adminAddComment`), auto-scroll newest |
| `MediaSection` | Attachments + uploaded media | photo grid add/remove (`uploadToCloudinary`+`adminUpdateSubmission`), Drive links, CP-shared media, lightbox |
| `EditFieldsSection` | Edit mode grid | `EDITABLE_FIELDS`, save changed-only (`adminUpdateSubmission`), admin only |

Each section returns `null` when its data/permissions don't apply (same conditions as today). **Do NOT** port the WhatsApp section (removed) or the outer drawer chrome (the host provides layout).

- [ ] **Step 3: Verify build**

```bash
cd frontend && npm run build
```
Expected: build succeeds (sections compile; unused-until-Task-3 is fine).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/submissions/detail frontend/src/components/{MatchDetailsModal,ConfirmDialog,Skeleton}.jsx
git commit -m "refactor(submissions): extract CP DetailPanel into reusable sections"
```

---

## Task 2: Submissions page shell (toolbar + data + view toggle)

**Files:**
- Create: `frontend/src/pages/Submissions.jsx` (replaces the P2 stub)
- Reference: CP `screens/Admin/index.jsx` (data/pagination/filter/bulk orchestration), Direct `components/InventoryBoard.jsx` (toolbar layout)

**Interfaces:**
- Consumes: `api.adminListSubmissions`, `api.adminListRms`, `downloadAdminCsv`, `useAuth()`.
- Produces: `<Submissions/>` rendering the toolbar + `<BoardView>` or `<TableView>` (Task 3) + `<FilterModal>` (Task 4) + `<BulkBar>` (Task 5). Holds all shared state.

- [ ] **Step 1: Port the orchestration state + data loader from CP `index.jsx`**

Create `frontend/src/pages/Submissions.jsx` carrying CP's exact state and loaders, minus the router-page subviews (`externalInventoryOpen`, `activityLogOpen`, `adminPanelOpen`, `whatsappInboxOpen`, `viewAsCpOpen`, `addingInventory` — those are now `/oh-properties`, `/logs`, `/users`, `/impersonator`, and the on-behalf flow keeps its modal). Retain: `city`, `searchInput`/`search`, `view` (`'board'|'table'`), `submissions`, `counts`, `loading`, `PAGE_SIZE=15`, `loadedByStage`/`loadingByStage`, `selectedId`, `cpHistoryId`, `bulkMode`/`selectedIds`/`bulkBusy`, `bulkScheduleOpen`/`bulkReassignOpen`, filter state (`showFilters`, `bhk`, `dateFrom`, `dateTo`, `rmFilter`, `statusFilter`), `rms`. Reuse CP's `reload()`, `loadMoreStage(stage)`, and `serverStatus = view === 'table' ? statusFilter : ''` logic verbatim (only rename the component/return). The list call stays:

```js
const effectiveFilters = { city, search, bhk, date_from: dateFrom, date_to: dateTo,
  rm_id: rmFilter, status: serverStatus };
const data = await api.adminListSubmissions({ ...effectiveFilters, limit: PAGE_SIZE });
```

- [ ] **Step 2: Build the Direct-style toolbar**

Render (Direct `.toolbar` classes): city tabs (`.city-tabs` pill group — All + CP's cities), search form (submit-to-apply), **Filters (N)** ghost button (N = count of active filters) opening `<FilterModal>`, a **view toggle** segmented pill (Board/Table), a **Select** toggle (bulk mode; hidden for viewers), **Download CSV** ghost (`downloadAdminCsv(effectiveFilters)`), and **+ Add Inventory** primary (opens the on-behalf flow; hidden for viewers). View toggle:

```jsx
<div className="view-toggle" role="tablist">
  <button className={`vt-btn ${view === 'board' ? 'on' : ''}`} onClick={() => setView('board')}>Board</button>
  <button className={`vt-btn ${view === 'table' ? 'on' : ''}`} onClick={() => setView('table')}>Table</button>
</div>
```

- [ ] **Step 3: Render the active view + stat pills**

Above the view, render CP stage **count pills** (`.count-pill`, from `counts`), clickable to set `statusFilter` (table view narrows to one stage; board collapses to that column — CP's existing behavior). Then `{view === 'board' ? <BoardView .../> : <TableView .../>}` passing `submissions`, `counts`, `loadedByStage`, `loadingByStage`, `onLoadMore={loadMoreStage}`, `onOpen={setSelectedId}`, `bulkMode`, `selectedIds`, `onToggleSelect`, `canAct`.

- [ ] **Step 4: Wire modals/drawers**

Mount (when their state is set): `<FilterModal>` (Task 4), `<CardDetailModal id={selectedId}>` (Task 3), `<BulkBar>` (Task 5), CP's `CpHistoryDrawer` (copy from CP, retokened) for `cpHistoryId`, and the bulk schedule/reassign modals (copy CP `BulkScheduleVisitModal`/`BulkReassignRmModal`, retokened).

- [ ] **Step 5: Build + manual check**

```bash
cd frontend && npm run build && npm run dev
```
Expected: `/submissions` shows toolbar + stat pills + (empty until Task 3 wires views). Board/Table toggle flips state; Filters button opens (empty until Task 4).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Submissions.jsx && git commit -m "feat(submissions): page shell — toolbar, data load, view toggle"
```

---

## Task 3: Board view, Table view + ExpandPanel, CardDetailModal

**Files:**
- Create: `frontend/src/components/submissions/{BoardView,TableView,ExpandPanel,CardDetailModal}.jsx`
- Reference: CP `Admin/BoardView.jsx`, `Admin/TableView.jsx`; Direct `components/{InventoryTable,ExpandPanel}.jsx`

**Interfaces:**
- Consumes: the Task 1 detail sections, `api.adminGetSubmission`.
- Produces: board + table renderers; row-expand and card-modal detail, both composing the Task 1 sections.

- [ ] **Step 1: BoardView (port CP, retokened)**

Port CP `BoardView.jsx` verbatim into `components/submissions/BoardView.jsx`, swapping classes for tokens: columns `.board-column`, cards `.board-card` on `.card-block`; column header = `.stage-dot` (color per `STAGES[i].color`) + label + count. Keep **every** card element (society/city/public_id, unit line, BHK/sqft chips, match badges — clickable → `MatchDetailsModal`, schedule badge, status_reason pill, price grid asking/counter/OH, RM line, footer, tint priority) and the `LoadMoreSentinel` IntersectionObserver. Card click → `onOpen(submission.id)`.

- [ ] **Step 2: TableView (Direct InventoryTable shell, CP columns)**

Create `components/submissions/TableView.jsx` from Direct `InventoryTable.jsx`: sticky `.inv-table` with `SortTh` sortable headers (`↕/▲/▼`), CP columns in order — Listing ID (+`PERFECT`/`WITHDRAWN`/`📅` tags) · Society (+⚠weak) · City · Unit (`tower-unit · F{floor}`) · Config (`{bhk} BHK · {sqft}`) · Asking (`.val-orange`) · OH Price (`formatOhPrice`) · CP (`cp_name`/`cp_code` + on-behalf) · Status (`.status-pill` + reason + match chips) · Submitted (`timeAgo`). Keep CP's `SORT_ACCESSORS` + row-tint priority. **Row click toggles an inline `<ExpandPanel>`** (Direct pattern):

```jsx
{open === row.id && (
  <tr className="expand-row"><td colSpan={COLS}><ExpandPanel id={row.id} canAct={canAct} onChanged={patchRow} /></td></tr>
)}
```
Bulk mode adds the select-all header + per-row checkboxes (CP behavior). Infinite scroll uses the same `onLoadMore` fan-out as CP.

- [ ] **Step 3: ExpandPanel (Direct layout, CP sections)**

Create `components/submissions/ExpandPanel.jsx` from Direct `ExpandPanel.jsx`: lazy-fetch `api.adminGetSubmission(id)` on expand (skeleton until loaded), then render the flex-row sections using Task 1 components:

```jsx
<div className="expand-inner">
  <div className="expand-sec expand-sec-wide">
    <UnitDetailsSection submission={s} canAct={canAct} onChanged={onChanged} />
    <EditFieldsSection submission={s} canAct={canAct} onChanged={onChanged} />
  </div>
  <div className="expand-sec"><PricingSection .../><CounterOfferSection .../></div>
  <div className="expand-sec expand-sec-narrow"><PeopleSection .../><ReassignRmSection .../></div>
  <div className="expand-sec"><StatusSection .../><ScheduleVisitSection .../><NotesSection .../></div>
  {/* Tickets section added in P5 */}
  <div className="expand-sec"><MediaSection .../></div>
</div>
```

- [ ] **Step 4: CardDetailModal (board-card click)**

Create `components/submissions/CardDetailModal.jsx` from Direct's `CardDetailModal` pattern (`.modal-wide`, blurred backdrop, Esc closes): header (society + city chip + public_id chip + stage dot/label) + a body that embeds the **same** section composition as `ExpandPanel` (extract the section layout into a shared `<SubmissionSections s=… canAct=… onChanged=… />` used by both). Opened by `selectedId` from the page.

- [ ] **Step 5: Build + manual check**

```bash
cd frontend && npm run build && npm run dev
```
Expected: board cards render with CP content; switching to table shows sortable columns; clicking a row expands inline detail with working status/counter/notes/etc.; clicking a board card opens the modal with the same sections; viewer sees no action controls.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/submissions && git commit -m "feat(submissions): board, table+expand, card-detail modal"
```

---

## Task 4: Detailed filter modal

**Files:**
- Create: `frontend/src/components/submissions/FilterModal.jsx`, `frontend/src/components/SearchableMultiSelect.jsx` (copy from Direct)
- Reference: Direct `components/FilterPanel.jsx`, `SearchableMultiSelect.jsx`

**Interfaces:**
- Consumes: `api.adminListRms` (RM options), `format.js` (`STAGES`, `REJECTED_REASONS`, BHK options).
- Produces: `<FilterModal open onApply(applied) onClose>` where `applied` maps to the page's filter state.

- [ ] **Step 1: Copy the multiselect primitive**

```bash
cp "/Users/oh-sahaj/Documents/GitHub/Direct_Inventory/frontend/src/components/SearchableMultiSelect.jsx" frontend/src/components/SearchableMultiSelect.jsx
```

- [ ] **Step 2: Build the CP filter modal from Direct's `FilterPanel`**

Create `FilterModal.jsx` from Direct `FilterPanel.jsx` (`.modal .filter-modal`, 2-col `.filter-grid`, Reset/Cancel/Apply footer, two-state form-vs-applied), with **CP filter blocks**:

| Block | Control | Maps to page state |
|---|---|---|
| BHK | pill row (from `format.js` BHK options) | `bhk` |
| Stage | multi-select pills (`STAGES`) | `statusFilter` (single today; keep single-select to match CP's `status` param, or send first-selected) |
| Match type | pills: Perfect / Collated / Submissions / Weak | client-side filter flags (post-filter the loaded rows; CP has no server param) |
| Missing info | pills: No asking price / No seller | client-side flags |
| Asking price (₹) | `.range-row` min/to/max | client-side numeric filter |
| OH Price | pills: Has OH Price / Check Price | client-side flag |
| RM | multiselect (from `adminListRms`), admin/manager only | `rmFilter` (`rm_id`) |
| Rejected reason | pills (`REJECTED_REASONS`), shown when a Rejected stage is selected | client-side flag |
| Date submitted | preset grid (Today/Yesterday/Week/Month/Custom) → range | `dateFrom`/`dateTo` (`date_from`/`date_to`) |

Server-backed filters (`bhk`, `status`, `rm_id`, `date_from`, `date_to`, `city`, `search`) drive `adminListSubmissions`; the client-only refinements (match type, missing info, price range, OH price, reject reason) filter the returned rows in the page before rendering. `onApply` returns both sets; the toolbar's "Filters (N)" counts all active.

- [ ] **Step 3: Build + manual check**

```bash
cd frontend && npm run build && npm run dev
```
Expected: Filters modal opens with all blocks; applying updates the board/table + the toolbar count; Reset clears.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/submissions/FilterModal.jsx frontend/src/components/SearchableMultiSelect.jsx
git commit -m "feat(submissions): detailed filter modal (CP fields, Direct layout)"
```

---

## Task 5: Floating bulk-action bar

**Files:**
- Create: `frontend/src/components/submissions/BulkBar.jsx`
- Copy (retokened): `frontend/src/components/submissions/{BulkScheduleVisitModal,BulkReassignRmModal}.jsx` from CP
- Reference: Direct `components/BulkActionBar.jsx`; CP `Admin/{BulkScheduleVisitModal,BulkReassignRmModal}.jsx`

**Interfaces:**
- Consumes: `api.adminBulkStatus`, `api.adminBulkScheduleVisit`, `api.adminBulkReassignListingRm`, selected id set from the page.
- Produces: `<BulkBar selectedIds onApplyStatus onSchedule onReassign onClear />`.

- [ ] **Step 1: Build the floating bar from Direct's `BulkActionBar`**

Create `BulkBar.jsx` (`.bulk-bar` fixed, orange-bordered): "N selected" + an action `<select>` — **Change Stage** (stage dropdown → reject-reason if a Rejected stage; `adminBulkStatus`), **Schedule Visit** (opens `BulkScheduleVisitModal`), **Reassign RM** (admin/manager; opens `BulkReassignRmModal`) — + Apply/Cancel. "Select all matching" fetches every matching id across pages (CP behavior).

- [ ] **Step 2: Port the two bulk modals**

```bash
CP="/Users/oh-sahaj/Documents/GitHub/CP-Inventory-Portal/frontend/src/screens/Admin"
cp "$CP/BulkScheduleVisitModal.jsx" frontend/src/components/submissions/BulkScheduleVisitModal.jsx
cp "$CP/BulkReassignRmModal.jsx" frontend/src/components/submissions/BulkReassignRmModal.jsx
```
Retoken classes; keep logic (field-exec dropdown, 20-item cap, `adminBulkScheduleVisit`; RM dropdown, `adminBulkReassignListingRm`).

- [ ] **Step 3: Build + manual check**

```bash
cd frontend && npm run build && npm run dev
```
Expected: entering Select mode shows checkboxes; selecting rows shows the floating bar; bulk status/schedule/reassign apply and reload; viewer never sees Select.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/submissions && git commit -m "feat(submissions): floating bulk-action bar + bulk modals"
```

---

## Self-Review

**Spec coverage (spec §9.2):** board+table toggle → Task 2/3; CP card/column content → Task 3; Direct row-expand with CP sections → Task 1+3; card-detail modal → Task 3; detailed filter modal → Task 4; bulk bar (status/schedule/reassign) → Task 5; viewer read-only → gated throughout. ✅

**Placeholder scan:** port tasks name their exact source file + the fields/behaviors to preserve; new glue (view toggle, filter param mapping, expand composition, bulk bar) has complete code or explicit control lists. The Tickets expand section is explicitly deferred to P5 (marked in Task 3 Step 3). ✅

**Type/name consistency:** section signature `{ submission, canAct, onChanged }` is defined in Task 1 and consumed identically in Task 3 (ExpandPanel/CardDetailModal). Filter keys (`bhk`, `status`, `rm_id`, `date_from`, `date_to`) in Task 4 match Task 2's `effectiveFilters` and CP's `adminListSubmissions` wire format. `onOpen(id)` / `selectedId` thread from page → BoardView/TableView → CardDetailModal consistently. ✅

**Carried to P5:** the ExpandPanel/CardDetailModal Tickets section (inline "New Ticket" + this submission's tickets) attaches here once the Tickets components exist.
