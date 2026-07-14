# P6 — Impersonator (Inline) + CP Mobile Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. **Port-and-wire.**

**Goal:** (1) The Impersonator page: an admin searches a CP and views the CP's experience embedded inline in a framed "viewing as" panel, reusing the existing secure token flow. (2) The CP mobile flow (Dashboard, Add-Unit, submission detail) ported into `CpApp` with the new design tokens and `wa.me`→`tel:` — so the embed looks native and the `cp`-role login works.

**Architecture:** The impersonation mechanism is unchanged — mint a CP-scoped token (`adminImpersonateCp`), hand it to a **same-origin `<iframe src="/?impersonate=1#it=<token>">`**. `auth.js`'s `bootstrapImpersonation()` (ported verbatim in P2) captures the token per-frame; inside the iframe the app sees `role==='cp'` and renders `CpApp`. The staff app in the parent frame keeps its cookie session — the iframe is an isolated browsing context, so the CP token never contaminates staff calls. `CpApp` is the light-restyled CP mobile flow, used both by a real `cp` login and inside the iframe.

**Tech Stack:** React 18, react-router, CP `api.js`/`auth.js` (P2), design tokens (P2).

## Global Constraints

- **Do not change `auth.js`.** The impersonation plumbing (`bootstrapImpersonation`, `getToken`, per-tab `sessionStorage`, `isImpersonating`) is reused exactly as ported in P2. The iframe relies on it.
- **Endpoints:** `api.adminCpSearch(q, limit, city)`, `api.adminImpersonateCp(cpId)` (both existing). CP flow uses the existing CP endpoints (`listSubmissions`, `createSubmission`, `counterOfferResponse`, `listMySubmissionEvents`, `shareMedia`, `deleteVideo`, `bookVisit`, `getMyRm`, `searchSocieties`).
- **No WhatsApp.** The CP Dashboard's `wa.me` "Contact RM" pill + `.wa-fab` become **`tel:` call links** to the RM (from `getMyRm`). No Interakt anywhere.
- **Impersonator is admin-only** (P2 router already gates `/impersonator`).
- **Interface-only for the CP flow:** structure/logic unchanged; only tokens/fonts/classes + the `tel:` swap.

## File Structure
`frontend/src/pages/Impersonator.jsx` (replaces P2 stub).
`frontend/src/pages/CpApp.jsx` (replaces P2 stub) + `frontend/src/cp/`: `Dashboard.jsx`, `SubmissionDetailModal.jsx`, `AddUnit/*` and CP components (`MediaVisitActions`, `ShareMediaModal`, `BookVisitModal`, `AgingStrip`, `InstallPrompt`), all ported from CP and retokened.
`frontend/src/components/CpSelector.jsx` — copy from CP (typeahead).
Reference: CP `screens/{Dashboard,SubmissionDetailModal,Login}.jsx`, `screens/AddUnit/*`, `screens/Admin/{ViewAsCpModal,CpSelector}.jsx`, `components/{MediaVisitActions,ShareMediaModal,BookVisitModal,AgingStrip,InstallPrompt}.jsx`, `cloudinary.js`, `timer.js`.

---

## Task 1: Port the CP mobile flow into `CpApp` (restyled)

**Files:** Create `frontend/src/pages/CpApp.jsx`, `frontend/src/cp/*`, copy `frontend/src/cloudinary.js` + `timer.js`. Reference: CP `screens/Dashboard.jsx`, `SubmissionDetailModal.jsx`, `AddUnit/*` + CP components.

**Interfaces:** Consumes CP-side `api.*` methods + `useAuth()` (`user.impersonated_by` drives the banner).

- [ ] **Step 1: Copy CP media/util modules verbatim**

```bash
CP="/Users/oh-sahaj/Documents/GitHub/CP-Inventory-Portal/frontend/src"
cp "$CP/cloudinary.js" frontend/src/cloudinary.js
cp "$CP/timer.js" frontend/src/timer.js
mkdir -p frontend/src/cp/AddUnit
for f in components/MediaVisitActions.jsx components/ShareMediaModal.jsx components/BookVisitModal.jsx components/AgingStrip.jsx components/InstallPrompt.jsx; do
  cp "$CP/$f" "frontend/src/cp/$(basename $f)"
done
cp "$CP"/screens/AddUnit/*.jsx frontend/src/cp/AddUnit/
cp "$CP/screens/Dashboard.jsx" frontend/src/cp/Dashboard.jsx
cp "$CP/screens/SubmissionDetailModal.jsx" frontend/src/cp/SubmissionDetailModal.jsx
```

- [ ] **Step 2: Retint + swap WhatsApp for `tel:` in `cp/Dashboard.jsx`**

Keep all logic. Restyle with tokens (the CP `.app-shell` 480px column stays — it's the phone layout). Replace the two `wa.me` affordances with `tel:` links to the RM:

```jsx
// was: <a href={`https://wa.me/${rmPhone}`} …>Contact your RM on WhatsApp</a>
<a className="btn-primary" href={`tel:${(rmPhone || '').replace(/\D/g, '')}`}>📞 Call your RM</a>
```
Remove the `.wa-fab` floating button (or convert to a `tel:` FAB). Drop any WhatsApp imports/state that only fed those links (`rmName`/`rmPhone` stay only if the `tel:` link uses them — it does).

- [ ] **Step 3: `CpApp.jsx` — the 2-screen CP state machine + impersonation banner**

```jsx
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { clearSession } from '../auth';
import Dashboard from '../cp/Dashboard.jsx';
import AddUnit from '../cp/AddUnit/index.jsx';

export default function CpApp() {
  const { user } = useAuth();
  const [screen, setScreen] = useState('dashboard');
  return (
    <div className="app-shell-cp">
      {user?.impersonated_by && (
        <div className="imp-banner">
          👁 Viewing as {user.name} · impersonated by {user.impersonated_by}
          <button className="btn-link" onClick={() => { clearSession(); window.location.assign('/'); }}>Exit</button>
        </div>
      )}
      {screen === 'addUnit'
        ? <AddUnit onDone={() => setScreen('dashboard')} />
        : <Dashboard onAdd={() => setScreen('addUnit')} />}
    </div>
  );
}
```
(Mirrors CP's `App.jsx` Shell CP branch. The banner styling `.imp-banner` = sticky sky-blue bar.)

- [ ] **Step 4: Build + manual check** — log in as a `cp` user (or via the impersonation flow in Task 2): the phone-column dashboard renders retokened; "Call your RM" is a `tel:` link; Add-Unit flow works; no WhatsApp anywhere. Commit: `feat(cp): port CP mobile flow into CpApp (restyled, tel: not wa.me)`.

---

## Task 2: Impersonator page (inline iframe embed)

**Files:** Create `frontend/src/pages/Impersonator.jsx`, copy `frontend/src/components/CpSelector.jsx`. Reference: CP `Admin/{ViewAsCpModal,CpSelector}.jsx`, `auth.js`.

**Interfaces:** Consumes `api.adminImpersonateCp(cpId)`, `api.adminCpSearch`.

- [ ] **Step 1: Copy the CP typeahead**

```bash
cp "/Users/oh-sahaj/Documents/GitHub/CP-Inventory-Portal/frontend/src/screens/Admin/CpSelector.jsx" frontend/src/components/CpSelector.jsx
```
(Retoken; keep the debounced `adminCpSearch` + keyboard nav.)

- [ ] **Step 2: The Impersonator page — search then embed**

Create `pages/Impersonator.jsx`:

```jsx
import { useState } from 'react';
import { api } from '../api';
import CpSelector from '../components/CpSelector.jsx';

export default function Impersonator() {
  const [cp, setCp] = useState(null);
  const [src, setSrc] = useState(null);
  const [error, setError] = useState(null);

  async function open(picked) {
    setCp(picked); setError(null);
    try {
      const { token } = await api.adminImpersonateCp(picked.id);
      // Same-origin iframe; auth.js bootstrapImpersonation() captures #it=,
      // isolates the CP token to THIS frame, and the app inside renders CpApp.
      setSrc(`/?impersonate=1#it=${encodeURIComponent(token)}`);
    } catch (e) {
      setError(e?.data?.error || 'Could not start impersonation');
    }
  }

  function exit() { setCp(null); setSrc(null); }

  if (src) {
    return (
      <div className="imp-frame-wrap">
        <div className="imp-frame-bar">
          👁 Viewing as <b>{cp?.name}</b> · {cp?.cp_code} · {cp?.phone}
          <button className="btn-ghost" onClick={exit}>Exit</button>
        </div>
        <iframe className="imp-frame" title="Viewing as CP" src={src} />
      </div>
    );
  }

  return (
    <div className="page-head">
      <h2>Impersonator</h2>
      <div className="ph-sub muted">Search a channel partner and view their app as they see it.</div>
      {error && <div className="modal-error">{error}</div>}
      <div className="card-block" style={{ maxWidth: 640, marginTop: 16 }}>
        <CpSelector city="" onSelect={open} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Styles for the frame**

Add to `styles.css`:

```css
.imp-frame-wrap { display: flex; flex-direction: column; height: calc(100vh - var(--topbar-h) - 48px); }
.imp-frame-bar { display: flex; align-items: center; gap: 10px; padding: 10px 14px;
  background: #e8f2ff; color: #0b4a8f; border: 1px solid #bcdcff; border-radius: var(--r) var(--r) 0 0; }
.imp-frame-bar button { margin-left: auto; }
.imp-frame { flex: 1; width: 100%; border: 1px solid var(--border); border-top: none;
  border-radius: 0 0 var(--r) var(--r); background: var(--surface); }
```

- [ ] **Step 4: Verify the isolation (manual)**

```bash
cd frontend && npm run dev
```
As an **admin**: open `/impersonator`, search + pick a CP → the framed panel shows that CP's dashboard (with the in-app "Viewing as … Exit" banner from Task 1). Confirm: (a) the parent staff app still works (nav to `/submissions`, calls succeed with the admin cookie), (b) "Exit" (bar or in-frame) tears the frame down and returns to search, (c) the address bar never shows the `#it=` token (stripped by `bootstrapImpersonation`). Every write inside the frame is audited server-side (existing behavior).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Impersonator.jsx frontend/src/components/CpSelector.jsx frontend/src/styles.css
git commit -m "feat(impersonator): inline iframe embed reusing secure token flow"
```

---

## Self-Review

**Spec coverage (§6, §9.3, §9.9, D1, D4):** inline iframe impersonation reusing the token/isolation model (§6, D4) → Task 2; CP mobile restyle + `wa.me`→`tel:` (§9.9, D1, spec §7B) → Task 1; the impersonation banner + Exit → Tasks 1 & 2. ✅

**Placeholder scan:** all new code (CpApp machine, Impersonator page, frame styles) is complete; ports name their source files + the exact retint/swap. ✅

**Type/name consistency:** the iframe URL `/?impersonate=1#it=<token>` matches `auth.js` `bootstrapImpersonation()` exactly (P2 verbatim copy). `api.adminImpersonateCp` returns `{ token }` (matches CP api.js). `user.impersonated_by` drives both the in-frame banner (Task 1) and is set by the backend `/api/me` (unchanged). `clearSession()` from `auth.js` ends only the per-tab impersonation (safe). ✅

---

## Full plan set — completion check

With P1–P6 written, every spec section maps to a task:
- §4 design system → P2 · §5 shell/routing/gating → P2 · §6 impersonator → P6 · §7 WhatsApp removal → P1 (backend) + P6 (`tel:` swap) · §8 Tickets → P1 (backend) + P5 (frontend) · §9.1 Home → P4 · §9.2 Submissions → P3 · §9.3 Impersonator → P6 · §9.4 OH Properties → P4 · §9.5 Logs → P4 · §9.6 Users → P4 · §9.7 Tickets → P5 · §9.8 Profile → P4 · §9.9 CP restyle → P6 · §10 logging → P1 (backend) + P4 (Logs renderer) · §11 frozen contract → P1 · §12 migrations → P1.
