# P5 — Tickets Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. **Port-and-wire** from Direct_Inventory's Tickets UI, adapted to CP's submission-linked model.

**Goal:** Ship Tickets end-to-end on the frontend — a workspace page (3 tabs), a two-mode create flow (on a submission / direct-to-RM), a detail modal with the reply thread, an inline "New Ticket" on submission expand panels, and the sidebar pending-count dot (already polling from P2).

**Architecture:** Port Direct's `Tickets.jsx` / `TicketModal.jsx` / `CreateTicketModal.jsx` / `CreateTicketButton.jsx`, swapping Direct's `oh_id`/inventory model for CP's `submission_id`/submissions model and Direct's `users` RM picker for CP's `adminListRms`. All calls go through the P2 `api.ticket*` methods (P1 backend). Wire the `CreateTicketButton` into the Layout topbar on the tickets route, and add the deferred Tickets section to P3's submission expand.

**Tech Stack:** React 18, react-router, `api.ticket*` (P2), CP `adminCpSearch`-style search over submissions.

## Global Constraints

- **Endpoints (P1):** `api.ticketsList({submission_id?, status?, scope?, limit, offset})`, `ticketsPendingCount()`, `ticketGet(id)`, `ticketCreate({title, summary?, submission_id? | rm_id?})`, `ticketReply(id, body)`, `ticketClose(id)`, `ticketReopen(id)`. No other endpoints.
- **Visibility is server-enforced** (admin all / manager team / rm own / viewer none). The UI must not assume it can see a ticket it can't — handle 403/404 gracefully.
- **Create is admin/manager only.** RM replies. Viewer never reaches Tickets (P2 router blocks the route + hides nav).
- **Message thread fields** (from P1): `author_source`, `author_id`, `author_name`, `author_phone`, `author_role`, `body`, `created_at`. Avatars/identity use **name + phone** (no email).
- **Ticket linkage** is a **submission** (`submission_id` + `public_id` snapshot), not an `oh_id`. The property line shows `society_name · public_id · RM`.
- **Cross-tab freshness:** on any local mutation, dispatch `window` event `tickets:changed` (Layout's poll listens and refreshes the dot).

## File Structure
`frontend/src/pages/Tickets.jsx` (replaces P2 stub).
`frontend/src/components/tickets/`: `TicketModal.jsx`, `CreateTicketModal.jsx`, `CreateTicketButton.jsx`, `TicketsSection.jsx` (for submission expand), `ticketStatus.js` (badge helper).
Reference: Direct `pages/Tickets.jsx`, `components/{TicketModal,CreateTicketModal,CreateTicketButton}.jsx`, `ExpandPanel.jsx` lines 91–179 (`TicketsSection`).

---

## Task 1: Status helper + Tickets workspace page

**Files:** Create `frontend/src/components/tickets/ticketStatus.js`, `frontend/src/pages/Tickets.jsx`. Reference: Direct `pages/Tickets.jsx`.

**Interfaces:** Consumes `api.ticketsList`. Produces `<Tickets/>` with tabs → opens `<TicketModal>` (Task 2).

- [ ] **Step 1: Badge helper**

Create `ticketStatus.js`:

```js
export function ticketBadge(t) {
  if (t.status === 'closed') return { label: 'Closed', cls: 'tk-badge-closed' };
  if (t.awaiting === 'rm') return { label: 'Awaiting RM', cls: 'tk-badge-rm' };
  if (t.awaiting === 'creator') return { label: 'Awaiting review', cls: 'tk-badge-review' };
  return { label: 'Open', cls: 'tk-badge-open' };
}
```

- [ ] **Step 2: Workspace page (port Direct `Tickets.jsx`)**

Create `pages/Tickets.jsx`: 3 tabs — **Needs my action** (`scope: 'action'`, default), **Open** (`status: 'open'`), **Closed** (`status: 'closed'`). `PAGE_SIZE=50` offset paging with id-dedupe + "Load more". Ticket cards (`.tk-card` on `.card-block`): title + `ticketBadge`; property line `society_name · public_id · RM` (a button opening the P3 `CardDetailModal` for `submission_id`) or "Direct ticket"; summary; footer `message_count replies · last_activity_at`. Reload on window `tickets:changed`/`tickets:updated`. Card click → `<TicketModal id>`.

- [ ] **Step 3: Build + commit** → `/tickets` lists tickets by tab. Commit: `feat(tickets): workspace page + tabs`.

---

## Task 2: Ticket detail modal (thread + reply + close/reopen)

**Files:** Create `frontend/src/components/tickets/TicketModal.jsx`. Reference: Direct `components/TicketModal.jsx`.

**Interfaces:** Consumes `api.ticketGet/ticketReply/ticketClose/ticketReopen`, `useAuth()`. Props `{ id, onChanged, onClose }`.

- [ ] **Step 1: Port + adapt**

Hydrate `ticketGet(id)` on mount (skeleton until loaded). Header: title + `ticketBadge`; sub-line `society_name · public_id` (or "Direct ticket") `· RM: {assigned_rm_name}`; summary block. Conversation: `messages` sorted ascending, each = avatar (deterministic HSL from `author_phone||author_name`), `author_name`, `author_role` chip, `created_at`, `body`. **Reply box** when `status==='open'` and caller is admin OR creator OR assigned RM (server also enforces; hide the box otherwise; Enter sends `ticketReply`). **Close** button when open & (admin|creator); **Reopen** when closed & (admin|creator). After each mutation: update local state, call `onChanged(updated)` (host patches its list), and `window.dispatchEvent(new Event('tickets:changed'))`. Surface `err.data.error` on failures (incl. 403/409).

Identity check for showing controls (client-side hint; server authoritative):

```js
const me = useAuth().user;
const myKey = me.role === 'admin' ? ['cp', me.cp_id] : ['rm', me.rm_id];
const isCreator = t.created_by_source === myKey[0] && t.created_by_id === myKey[1];
const isAssignedRm = me.role === 'rm' && me.rm_id === t.assigned_rm_id;
const canReply = t.status === 'open' && (me.role === 'admin' || isCreator || isAssignedRm);
const canClose = me.role === 'admin' || isCreator;
```

- [ ] **Step 2: Build + commit** → opening a ticket shows the thread; RM reply flips the badge; close/reopen work; permissions hide controls. Commit: `feat(tickets): detail modal + reply thread`.

---

## Task 3: Create flow (two modes) + topbar button

**Files:** Create `frontend/src/components/tickets/{CreateTicketModal,CreateTicketButton}.jsx`; modify `frontend/src/components/Layout.jsx` (topbar button on tickets route). Reference: Direct `components/{CreateTicketModal,CreateTicketButton}.jsx`.

**Interfaces:** Consumes `api.ticketCreate`, `api.adminListSubmissions` (submission search), `api.adminListRms` (direct RM picker).

- [ ] **Step 1: CreateTicketModal (two modes)**

Toggle **"On a submission"** vs **"Direct to RM"** (admin/manager only):
- *Submission mode:* debounced (250ms) search via `api.adminListSubmissions({ search: q, limit: 10 })`; pick a row; show its resolved RM (from the row's `listing_rm_name || assigned_rm_name`); block submit if the submission has no RM. Payload `{ title, summary, submission_id }`.
- *Direct mode:* load `api.adminListRms()` once; managers client-filter to their team (rows where the RM reports to them — the server re-checks); pick an RM. Payload `{ title, summary, rm_id }`.
On success: `window.dispatchEvent(new Event('tickets:changed'))` + close.

- [ ] **Step 2: CreateTicketButton** — a topbar `.btn-primary` ("+ New Ticket") that opens `CreateTicketModal`; render only for admin/manager.

- [ ] **Step 3: Wire into Layout topbar**

In `frontend/src/components/Layout.jsx`, add to the topbar (before the theme toggle):

```jsx
{seg === 'tickets' && (isAdmin || isManager) && <CreateTicketButton />}
```
(Import `CreateTicketButton`. `isAdmin`/`isManager` already computed in P2's Layout.)

- [ ] **Step 4: Build + commit** → admin/manager see "+ New Ticket" on `/tickets`; both modes create; RMs/viewers don't see the button. Commit: `feat(tickets): two-mode create + topbar button`.

---

## Task 4: Inline Tickets section on submission expand

**Files:** Create `frontend/src/components/tickets/TicketsSection.jsx`; modify `frontend/src/components/submissions/ExpandPanel.jsx` + `CardDetailModal.jsx` (P3) to mount it. Reference: Direct `ExpandPanel.jsx` `TicketsSection`.

**Interfaces:** Consumes `api.ticketsList({ submission_id })`, `api.ticketCreate`.

- [ ] **Step 1: TicketsSection**

`<TicketsSection submissionId publicId canCreate />`: lazy-load `ticketsList({ submission_id })`; show latest with a "+N more" toggle; each row = title + `ticketBadge` (opens `TicketModal`). Admin/manager get an inline create form (title + summary → `ticketCreate({ submission_id, title, summary })`, prepend on success, dispatch `tickets:changed`).

- [ ] **Step 2: Mount in the submission detail**

In P3's `ExpandPanel.jsx` and the shared `SubmissionSections`, replace the `{/* Tickets section added in P5 */}` placeholder with:

```jsx
<div className="expand-sec">
  <TicketsSection submissionId={s.id} publicId={s.public_id} canCreate={canAct && role !== 'rm'} />
</div>
```
(`canCreate` = admin/manager; `role` from `useAuth`.)

- [ ] **Step 3: Build + commit** → expanding a submission shows its tickets + inline create for admin/manager. Commit: `feat(tickets): inline section on submission expand`.

---

## Self-Review

**Spec coverage (§8.6):** workspace tabs → Task 1; detail/thread/reply/close/reopen → Task 2; two-mode create + topbar → Task 3; inline submission section → Task 4; pending-count dot already polling from P2 Layout. ✅

**Placeholder scan:** the only "placeholder" referenced (P3's `{/* Tickets section added in P5 */}`) is explicitly replaced in Task 4 Step 2. All create/reply/close logic + permission hints shown. ✅

**Type/name consistency:** `api.ticket*` names match P2 Task 2. Message fields (`author_source/id/name/phone/role`) match P1's reply payload. Identity `(source,id)` comparison in Task 2 matches P1's `created_by_source/created_by_id`. `submission_id`/`public_id` linkage matches P1's migration + blueprint. `tickets:changed` event matches the P2 Layout poll listener. `ticketBadge` (Task 1) reused by Tasks 2 & 4. ✅
