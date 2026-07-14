# P2 — Frontend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Boot a `react-router` SPA in this repo with Direct_Inventory's design-token CSS, a collapsible sidebar `Layout`, role-gated navigation to the 8 (stubbed) staff pages, a theme toggle, the ported+extended API client, and working OTP login against the P1 backend.

**Architecture:** Greenfield staff shell. Port CP's auth-critical modules verbatim (`api.js`, `auth.js`, `AuthContext.jsx`, `format.js` — the impersonation + cookie logic must not drift), adopt Direct's `styles.css` design system + `ThemeContext` + collapsible `Layout`, and add `react-router-dom` v6 with `RequireAuth` role gating. Later plans (P3–P6) fill the page bodies; P2 stops at navigable stubs.

**Tech Stack:** React 18.3, Vite 6, `vite-plugin-pwa`, **`react-router-dom` 6.26** (new), plain CSS design tokens. No Tailwind, no UI kit.

## Global Constraints

- **Frozen backend contract.** The frontend `api.js` may drop the removed WhatsApp methods and add `/api/tickets/*` methods, but every retained method's path/verb/body matches P1 exactly.
- **Design tokens** are Direct's `styles.css` architecture; `--brand` is **Openhouse orange `#FF6B2B`** (single-token swap — spec §4). Typography: **Fraunces** (display) + **Inter** (UI).
- **Roles:** `admin` / `manager` / `rm` / `viewer` (staff) and `cp` (mobile flow). Nav gating per spec §5. Viewer is read-only and has **no Tickets/Impersonator/Logs/Users**.
- **Preserve impersonation plumbing** in `auth.js` verbatim — P6 (Impersonator) depends on `bootstrapImpersonation()` / `getToken()` / per-tab isolation being intact.
- **Auth is unchanged:** HttpOnly cookie for staff; `AuthContext.meBootstrap()` probe on mount; `bootstrapping` gates the first paint.

---

## File Structure

`frontend/` (new):
- `index.html` — SPA host (ported from CP, retitled)
- `package.json`, `vite.config.js` — React + PWA + `/api` dev proxy (ported from CP) + `react-router-dom`
- `src/main.jsx` — `createRoot`; wraps `<App/>` in `BrowserRouter` + `AuthProvider` + `ThemeProvider`; `registerSW`
- `src/styles.css` — **copied verbatim from Direct**, with `--brand*` retinted to Openhouse orange
- `src/api.js` — **ported from CP**, WhatsApp methods removed, `/api/tickets/*` methods added
- `src/auth.js` — **copied verbatim from CP** (impersonation + user cache)
- `src/format.js` — **copied verbatim from CP** (STAGES, price/date formatters — used by P3+)
- `src/contexts/AuthContext.jsx` — **copied verbatim from CP**
- `src/contexts/ThemeContext.jsx` — **copied from Direct**, storage key `oh_theme`
- `src/components/icons.jsx` — **copied from Direct**, plus CP nav glyphs
- `src/components/Layout.jsx` — **adapted from Direct** (CP nav, role gating, CP user shape, CP pending-count)
- `src/components/BusyOverlay.jsx` — **copied from Direct** (global "Saving…" overlay)
- `src/App.jsx` — router: `Shell` (branches cp vs staff) → `RequireAuth` + `Layout` + 8 routes
- `src/pages/Login.jsx` — **ported from CP** (OTP login), restyled with tokens
- `src/pages/{Home,Submissions,Impersonator,OhProperties,Logs,Users,Tickets,Profile}.jsx` — stubs (filled P3–P6)
- `src/pages/CpApp.jsx` — stub for the `cp`-role mobile flow (filled P6)

---

## Task 1: Scaffold the Vite app + design system

**Files:**
- Create: `frontend/package.json`, `frontend/vite.config.js`, `frontend/index.html`, `frontend/src/main.jsx`, `frontend/src/styles.css`, `frontend/src/App.jsx` (temporary minimal), `frontend/.env.example`
- Reference: `/Users/oh-sahaj/Documents/GitHub/CP-Inventory-Portal/frontend/{package.json,vite.config.js,index.html,src/main.jsx}`, `/Users/oh-sahaj/Documents/GitHub/Direct_Inventory/frontend/src/styles.css`

**Interfaces:**
- Produces: a dev server (`npm run dev`) serving a themed blank page; `styles.css` design tokens available app-wide.

- [ ] **Step 1: `frontend/package.json`**

```json
{
  "name": "cp-inventory-portal-frontend",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.2"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.1",
    "vite": "^6.0.0",
    "vite-plugin-pwa": "^0.20.5"
  }
}
```

- [ ] **Step 2: `frontend/vite.config.js`** (port CP's — React + PWA + `/api` proxy to the P1 backend on :5000)

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'CP OpenHouse', short_name: 'CP OpenHouse',
        theme_color: '#FF6B2B', display: 'standalone', start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,ico,png,svg}'] },
      devOptions: { enabled: true },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:5000', changeOrigin: true, cookieDomainRewrite: 'localhost' },
    },
  },
});
```

- [ ] **Step 3: `frontend/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#FF6B2B" />
    <title>Openhouse Sourcing Portal</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 4: `frontend/src/styles.css`** — copy Direct's design system verbatim, then retint brand

```bash
cp "/Users/oh-sahaj/Documents/GitHub/Direct_Inventory/frontend/src/styles.css" frontend/src/styles.css
```
Then in `frontend/src/styles.css` replace the light-theme `--brand*` block (lines ~12–16) with Openhouse orange:

```css
  --brand: #FF6B2B;
  --brand-strong: #E85A1F;
  --brand-soft: #FFF4EC;
  --brand-softer: #FFF9F5;
  --brand-ring: rgba(255, 107, 43, 0.18);
```
Leave the dark-theme brand block and all other tokens/classes as Direct authored them. (The rest of the file — buttons, pills, tables, modals, sidebar, cards — is the shared design system P3–P6 rely on.)

- [ ] **Step 5: `frontend/src/main.jsx`**

```jsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App.jsx';
import { AuthProvider } from './contexts/AuthContext.jsx';
import { ThemeProvider } from './contexts/ThemeContext.jsx';
import './styles.css';

registerSW({ immediate: true });

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
```

- [ ] **Step 6: temporary minimal `frontend/src/App.jsx`** (replaced in Task 4)

```jsx
export default function App() {
  return <div className="loading">CP Inventory Portal — foundation OK</div>;
}
```

- [ ] **Step 7: Stub the context/module files so `main.jsx` imports resolve** (real ports land in Tasks 2–3)

Create empty-ish placeholders that export the needed symbols so the app builds now:

`frontend/src/contexts/ThemeContext.jsx`:

```bash
cp "/Users/oh-sahaj/Documents/GitHub/Direct_Inventory/frontend/src/contexts/ThemeContext.jsx" frontend/src/contexts/ThemeContext.jsx
```
Then change its storage `KEY` from `'di_theme'` to `'oh_theme'`.

`frontend/src/contexts/AuthContext.jsx` — temporary stub (real port in Task 3):

```jsx
import { createContext, useContext } from 'react';
const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  return <AuthContext.Provider value={{ user: null, bootstrapping: false }}>{children}</AuthContext.Provider>;
}
export function useAuth() { return useContext(AuthContext); }
```

- [ ] **Step 8: Install + boot**

```bash
cd frontend && npm install
npm run build          # must succeed
npm run dev &          # serves http://localhost:5173
sleep 3 && curl -sS http://localhost:5173 | grep -q 'id="root"' && echo "DEV OK"; kill %1
```
Expected: `npm run build` succeeds; "DEV OK".

- [ ] **Step 9: Commit**

```bash
git add frontend/ && git commit -m "feat(frontend): scaffold Vite+router app with Direct design tokens"
```

---

## Task 2: Port the API client (strip WhatsApp, add Tickets) + format + auth

**Files:**
- Create: `frontend/src/api.js`, `frontend/src/auth.js`, `frontend/src/format.js`
- Reference: CP `frontend/src/{api.js,auth.js,format.js}`

**Interfaces:**
- Produces: `import { api, ApiError, downloadAdminCsv } from './api'` with the full CP surface **minus** `adminListWhatsAppThreads`/`adminGetWhatsAppThread`/`adminGetSubmissionWhatsApp`/`adminSendWhatsAppMessage`, **plus** `ticketsList`, `ticketsPendingCount`, `ticketGet`, `ticketCreate`, `ticketReply`, `ticketClose`, `ticketReopen`. `getToken`/`getUser`/`setUser`/`clearSession`/`isImpersonating` from `auth.js`.

- [ ] **Step 1: Copy `auth.js` and `format.js` verbatim**

```bash
cp "/Users/oh-sahaj/Documents/GitHub/CP-Inventory-Portal/frontend/src/auth.js" frontend/src/auth.js
cp "/Users/oh-sahaj/Documents/GitHub/CP-Inventory-Portal/frontend/src/format.js" frontend/src/format.js
```
(Do not edit — `auth.js` impersonation logic is reused by P6; `format.js` STAGES/formatters by P3+.)

- [ ] **Step 2: Copy `api.js` then remove the WhatsApp block**

```bash
cp "/Users/oh-sahaj/Documents/GitHub/CP-Inventory-Portal/frontend/src/api.js" frontend/src/api.js
```
Delete the four WhatsApp methods (the `// WhatsApp messages …` block: `adminListWhatsAppThreads`, `adminGetWhatsAppThread`, `adminGetSubmissionWhatsApp`, `adminSendWhatsAppMessage`).

- [ ] **Step 3: Add the Tickets methods**

In `frontend/src/api.js`, inside the `export const api = { … }` object (e.g. just before `// Health`), add:

```js
  // Tickets (staff only; admin/manager create, rm replies).
  ticketsList: (filters = {}) => request(`/tickets${buildQuery(filters)}`),
  ticketsPendingCount: () => request('/tickets/pending-count'),
  ticketGet: (id) => request(`/tickets/${id}`),
  // payload: { title, summary?, submission_id? | rm_id? }
  ticketCreate: (payload) => request('/tickets', { method: 'POST', body: payload }),
  ticketReply: (id, body) => request(`/tickets/${id}/reply`, { method: 'POST', body: { body } }),
  ticketClose: (id) => request(`/tickets/${id}/close`, { method: 'POST' }),
  ticketReopen: (id) => request(`/tickets/${id}/reopen`, { method: 'POST' }),
```

- [ ] **Step 4: Verify the module loads and the surface is correct**

```bash
cd frontend && node --input-type=module -e "
import { readFileSync } from 'node:fs';
const s = readFileSync('src/api.js','utf8');
for (const m of ['ticketsList','ticketsPendingCount','ticketGet','ticketCreate','ticketReply','ticketClose','ticketReopen'])
  if (!s.includes(m+':')) throw new Error('missing '+m);
for (const w of ['adminListWhatsAppThreads','adminSendWhatsAppMessage','/whatsapp/'])
  if (s.includes(w)) throw new Error('whatsapp still present: '+w);
console.log('api surface OK');
"
```
Expected: `api surface OK`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api.js frontend/src/auth.js frontend/src/format.js
git commit -m "feat(frontend): port api client (drop WhatsApp, add Tickets) + auth + format"
```

---

## Task 3: Auth context + OTP login page

**Files:**
- Create/replace: `frontend/src/contexts/AuthContext.jsx` (real port), `frontend/src/pages/Login.jsx`
- Reference: CP `frontend/src/contexts/AuthContext.jsx`, `frontend/src/screens/Login.jsx`, `frontend/src/components/OtpInput.jsx`

**Interfaces:**
- Consumes: `api.meBootstrap/sendOtp/verifyOtp/logout`, `auth.getUser/setUser/clearSession/isImpersonating`.
- Produces: `useAuth() → { user, loading, bootstrapping, sendOtp, verifyOtp, logout, login }`. `user` shape from `/api/me`: `{ role, name, phone, city, is_admin, cp_id|rm_id, impersonated_by? }`.

- [ ] **Step 1: Replace the stub `AuthContext.jsx` with CP's real one**

```bash
cp "/Users/oh-sahaj/Documents/GitHub/CP-Inventory-Portal/frontend/src/contexts/AuthContext.jsx" frontend/src/contexts/AuthContext.jsx
```
(Verbatim — it already imports from `../api` and `../auth`, both present. No edits.)

- [ ] **Step 2: Port the Login page + OtpInput, restyle with tokens**

```bash
cp "/Users/oh-sahaj/Documents/GitHub/CP-Inventory-Portal/frontend/src/components/OtpInput.jsx" frontend/src/components/OtpInput.jsx
cp "/Users/oh-sahaj/Documents/GitHub/CP-Inventory-Portal/frontend/src/screens/Login.jsx" frontend/src/pages/Login.jsx
```
In `frontend/src/pages/Login.jsx`: keep the OTP flow logic 1:1 (`sendOtp`→`verifyOtp`, resend cooldown, not-registered RM-contacts branch). Replace inline styles / old classnames with token classes: outer `.card-block` centered (`display:grid; place-items:center; min-height:100vh`), inputs use the global input styling, primary button `.btn-primary`, brand mark uses Fraunces. On `{ kind: 'authenticated' }` do nothing special — `AuthContext` sets `user`, and `RequireAuth` (Task 4) renders the app. (Login has no router dependency; it's shown when `!user`.)

- [ ] **Step 3: Verify build**

```bash
cd frontend && npm run build
```
Expected: build succeeds (AuthContext + Login compile).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/contexts/AuthContext.jsx frontend/src/pages/Login.jsx frontend/src/components/OtpInput.jsx
git commit -m "feat(frontend): real auth context + OTP login page"
```

---

## Task 4: Layout shell, icons, role-gated router, page stubs

**Files:**
- Create: `frontend/src/components/icons.jsx`, `frontend/src/components/Layout.jsx`, `frontend/src/components/BusyOverlay.jsx`, `frontend/src/App.jsx` (replace), `frontend/src/pages/{Home,Submissions,Impersonator,OhProperties,Logs,Users,Tickets,Profile,CpApp}.jsx`
- Reference: Direct `frontend/src/components/{Layout.jsx,icons.jsx,BusyOverlay.jsx}`

**Interfaces:**
- Consumes: `useAuth()`, `useTheme()`, `api.ticketsPendingCount()`.
- Produces: authenticated staff shell with sidebar nav to `/`, `/submissions`, `/impersonator`, `/oh-properties`, `/tickets`, `/logs`, `/users`, `/profile` (role-gated); each page renders a titled stub. `Shell` routes `role === 'cp'` to `<CpApp/>`.

- [ ] **Step 1: Copy the icon set + BusyOverlay from Direct**

```bash
cp "/Users/oh-sahaj/Documents/GitHub/Direct_Inventory/frontend/src/components/icons.jsx" frontend/src/components/icons.jsx
cp "/Users/oh-sahaj/Documents/GitHub/Direct_Inventory/frontend/src/components/BusyOverlay.jsx" frontend/src/components/BusyOverlay.jsx
```
Ensure `icons.jsx` exports the glyphs the CP nav needs: `IconHome, IconBoard (Submissions), IconEye (Impersonator), IconBuilding (OH Properties), IconTicket, IconLogs, IconUsers, IconProfile, IconSun, IconMoon, IconMenu, IconLogout, IconChevron`. Direct's file already has most; for any missing (`IconBoard`, `IconEye`, `IconBuilding`, `IconProfile`) add a 24×24 `currentColor` stroke SVG following the existing pattern, e.g.:

```jsx
export const IconEye = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />
  </svg>
);
```

- [ ] **Step 2: Write the CP `Layout.jsx` (adapted from Direct)**

Create `frontend/src/components/Layout.jsx`:

```jsx
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useTheme } from '../contexts/ThemeContext.jsx';
import BusyOverlay from './BusyOverlay.jsx';
import {
  IconHome, IconBoard, IconEye, IconBuilding, IconTicket, IconLogs, IconUsers, IconProfile,
  IconSun, IconMoon, IconMenu, IconLogout, IconChevron,
} from './icons.jsx';

const TITLES = {
  '': 'Home', submissions: 'Submissions', impersonator: 'Impersonator',
  'oh-properties': 'OH Properties', tickets: 'Tickets', logs: 'Activity Logs',
  users: 'Users', profile: 'My Profile',
};

function initials(name, phone) {
  const s = (name || phone || '').trim();
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase() || '?';
}

export default function Layout() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const nav = useNavigate();
  const loc = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('oh_sidebar_collapsed') === '1');
  const [ticketDot, setTicketDot] = useState(0);

  const role = user?.role;
  const isAdmin = role === 'admin';
  const isManager = role === 'manager';
  const canTickets = role === 'admin' || role === 'manager' || role === 'rm';

  // Poll "needs my action" ticket count for the nav dot (skip for roles with no
  // ticket access). 15s while visible; on focus; on local ticket mutations.
  useEffect(() => {
    if (!canTickets) return undefined;
    let alive = true;
    const refresh = () => api.ticketsPendingCount()
      .then((r) => { if (alive) setTicketDot(r?.count || 0); })
      .catch(() => {});
    refresh();
    const id = setInterval(() => { if (!document.hidden) refresh(); }, 15000);
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('tickets:changed', refresh);
    return () => {
      alive = false; clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('tickets:changed', refresh);
    };
  }, [canTickets]);

  const seg = loc.pathname.split('/')[1] || '';
  const title = TITLES[seg] || 'CP Inventory';

  function toggleCollapse() {
    setCollapsed((c) => { const n = !c; localStorage.setItem('oh_sidebar_collapsed', n ? '1' : '0'); return n; });
  }

  const navItem = ({ to, label, Icon, end, dot }) => {
    const showDot = dot && ticketDot > 0;
    return (
      <NavLink key={to} to={to} end={end}
        className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
        onClick={() => setMobileOpen(false)} title={collapsed ? label : undefined}>
        <span className="nav-ic"><Icon />{showDot && <span className="nav-dot" />}</span>
        <span className="nav-label">{label}</span>
        {showDot && <span className="nav-count">{ticketDot}</span>}
      </NavLink>
    );
  };

  return (
    <div className={`app-shell ${collapsed ? 'collapsed' : ''}`}>
      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-text">
            <div className="brand-name">Openhouse</div>
            <div className="brand-sub">CP Inventory</div>
          </div>
        </div>
        <button className="sidebar-collapse-btn" onClick={toggleCollapse} aria-label="Toggle sidebar">
          <span className="scb-chev"><IconChevron size={16} /></span>
          <span className="scb-label">Collapse</span>
        </button>

        {navItem({ to: '/', label: 'Home', Icon: IconHome, end: true })}
        {navItem({ to: '/submissions', label: 'Submissions', Icon: IconBoard })}
        {navItem({ to: '/oh-properties', label: 'OH Properties', Icon: IconBuilding })}
        {canTickets && navItem({ to: '/tickets', label: 'Tickets', Icon: IconTicket, dot: true })}

        {isAdmin && (
          <>
            <div className="sidebar-section-label">Admin</div>
            {navItem({ to: '/impersonator', label: 'Impersonator', Icon: IconEye })}
            {navItem({ to: '/users', label: 'Users', Icon: IconUsers })}
            {navItem({ to: '/logs', label: 'Logs', Icon: IconLogs })}
          </>
        )}

        <div className="nav-spacer" />
        <div className="sidebar-foot">
          <button type="button" className="sidebar-user" onClick={() => { nav('/profile'); setMobileOpen(false); }} title="My profile">
            <span className="avatar">{initials(user?.name, user?.phone)}</span>
            <div className="su-text">
              <div className="su-name">{user?.name || user?.phone}</div>
              <div className="su-role">{role}</div>
            </div>
          </button>
        </div>
      </aside>

      {mobileOpen && <div className="modal-backdrop" style={{ zIndex: 400 }} onClick={() => setMobileOpen(false)} />}
      <div className="main-col">
        <header className="topbar">
          <button className="icon-btn topbar-menu" onClick={() => setMobileOpen(true)} aria-label="Menu"><IconMenu /></button>
          <h1>{title}</h1>
          <div className="topbar-spacer" />
          <button className="icon-btn" onClick={toggle} aria-label="Toggle theme">
            {theme === 'dark' ? <IconSun /> : <IconMoon />}
          </button>
          <button className="icon-btn" onClick={logout} aria-label="Logout" title="Logout"><IconLogout /></button>
        </header>
        <main className="main"><Outlet /></main>
      </div>
      <BusyOverlay />
    </div>
  );
}
```

- [ ] **Step 3: Write the 8 page stubs + CpApp stub**

For each of `Home, Submissions, Impersonator, OhProperties, Logs, Users, Tickets, Profile` create `frontend/src/pages/<Name>.jsx` following this template (substitute name/blurb):

```jsx
export default function Home() {
  return (
    <div className="page-head">
      <h2>Home</h2>
      <div className="ph-sub muted">Summary dashboard — built in P4.</div>
    </div>
  );
}
```
Blurbs: Submissions→"Board + table — P3", Impersonator→"View as CP — P6", OhProperties→"OH Properties — P4", Logs→"Activity logs — P4", Users→"Staff management — P4", Tickets→"Tickets workspace — P5", Profile→"My profile — P4".

Create `frontend/src/pages/CpApp.jsx`:

```jsx
export default function CpApp() {
  return <div className="loading">CP mobile experience — restyled in P6.</div>;
}
```

- [ ] **Step 4: Write the real `App.jsx` (Shell + role-gated router)**

Replace `frontend/src/App.jsx`:

```jsx
import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Home from './pages/Home.jsx';
import Submissions from './pages/Submissions.jsx';
import CpApp from './pages/CpApp.jsx';

const Impersonator = lazy(() => import('./pages/Impersonator.jsx'));
const OhProperties = lazy(() => import('./pages/OhProperties.jsx'));
const Logs = lazy(() => import('./pages/Logs.jsx'));
const Users = lazy(() => import('./pages/Users.jsx'));
const Tickets = lazy(() => import('./pages/Tickets.jsx'));
const Profile = lazy(() => import('./pages/Profile.jsx'));

const STAFF = ['admin', 'manager', 'rm', 'viewer'];

// roles=undefined → any authenticated staff; roles=[] → admin only;
// roles=[...] → those roles (admin always passes).
function RequireRole({ user, roles, children }) {
  if (roles && !roles.includes(user.role) && user.role !== 'admin') {
    return <Navigate to="/" replace />;
  }
  return children;
}

export default function App() {
  const { user, bootstrapping } = useAuth();
  if (bootstrapping) return <div className="loading">Loading…</div>;
  if (!user) return <Login />;
  if (!STAFF.includes(user.role)) return <CpApp />;   // role === 'cp'

  return (
    <Suspense fallback={<div className="loading">Loading…</div>}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/submissions" element={<Submissions />} />
          <Route path="/oh-properties" element={<OhProperties />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/tickets" element={<RequireRole user={user} roles={['manager', 'rm']}><Tickets /></RequireRole>} />
          <Route path="/impersonator" element={<RequireRole user={user} roles={[]}><Impersonator /></RequireRole>} />
          <Route path="/users" element={<RequireRole user={user} roles={[]}><Users /></RequireRole>} />
          <Route path="/logs" element={<RequireRole user={user} roles={[]}><Logs /></RequireRole>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
```

- [ ] **Step 5: Build**

```bash
cd frontend && npm run build
```
Expected: build succeeds (all imports resolve).

- [ ] **Step 6: Manual smoke (backend must be running from P1)**

```bash
cd frontend && npm run dev
```
Then in a browser at `http://localhost:5173`:
- Logged out → Login page renders (tokened).
- Log in as an **admin** → sidebar shows Home, Submissions, OH Properties, Tickets, and Admin section (Impersonator, Users, Logs); theme toggle flips light/dark; each nav item routes to its titled stub.
- Log in as a **viewer** → **no** Tickets / Impersonator / Users / Logs; visiting `/tickets` or `/users` redirects to `/`.
- Ticket nav dot shows a count if the logged-in user has pending tickets.

- [ ] **Step 7: Commit**

```bash
git add frontend/src && git commit -m "feat(frontend): Layout shell, role-gated router, page stubs"
```

---

## Self-Review

**Spec coverage:** design system (§4) → Task 1; app shell + routing + role gating (§5) → Task 4; auth unchanged (§5) → Task 3; api frozen + WhatsApp methods dropped + Tickets added (§7,§8,§11) → Task 2; page stubs seed P3–P6. ✅

**Placeholder scan:** page *bodies* are intentional stubs (each names the plan that fills it) — not hidden work; all *foundation* code is complete. ✅

**Type/name consistency:** `useAuth()` returns `bootstrapping` (CP shape) — used in `App.jsx`, not Direct's `loading`. `api.ticketsPendingCount()` (Task 2) is the exact method `Layout.jsx` (Task 4) calls. Nav routes (`/submissions`, `/oh-properties`, `/impersonator`) match the `App.jsx` `<Route path>` set and the P3–P6 page filenames. `--brand` retint (Task 1) is the only styles.css edit. ✅

**Carried to later plans:** P3 fills `Submissions.jsx` (imports `format.js` STAGES); P4 fills Home/OhProperties/Logs/Users/Profile; P5 fills `Tickets.jsx` + adds `CreateTicketButton` to the Layout topbar for admin/manager on the tickets route; P6 fills `Impersonator.jsx` + `CpApp.jsx` (reusing `auth.js` impersonation plumbing).
