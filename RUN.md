# Running locally

Two processes: the Flask **backend** (`:5000`) and the Vite **frontend** (`:5173`, which proxies `/api` → the backend). Both are already set up on this machine; the steps below also cover a fresh checkout.

## Prerequisites
- Python **3.12**, Node **20+** (this machine: 3.12.13 / node 24).
- `backend/.env` with a working `DATABASE_URL` + `JWT_SECRET` (gitignored — not in the repo; already restored here from the source portal's `.env`).

## Backend — terminal 1
```bash
cd backend
python3.12 -m venv venv                 # skip if venv/ already exists
./venv/bin/pip install -r requirements.txt
set -a && source ./.env && set +a       # load DATABASE_URL, JWT_SECRET, etc.
./venv/bin/python app.py                # → http://127.0.0.1:5000
```
Health check: `curl http://127.0.0.1:5000/api/health` → `{"ok": true, "databases": {"app": "ok", ...}}`

## Frontend — terminal 2
```bash
cd frontend
npm install                             # skip if node_modules/ is intact
npm run dev                             # → http://localhost:5173
```
Open **http://localhost:5173**. The dev server proxies `/api/*` to the backend, so the session cookie is first-party.

## Logging in
Login is phone + OTP. Use a phone that exists as a **staff** row (`rms`) or admin (`channel_partners`) in the DB to land on the staff dashboard; a CP phone lands on the (stub) CP flow. In local/dev, add a phone to `OTP_DEV_BYPASS_PHONES` (empty by default) to let it accept code **`000000`** without SMS. An unregistered phone shows the "contact your RM" screen.

## What works today
- **Backend:** fully functional — all original APIs (frozen), WhatsApp removed, **Tickets** added (`/api/tickets/*`). Run tests: `cd backend && set -a && source ./.env && set +a && RUN_DB_TESTS=1 TEST_DATABASE_URL="$DATABASE_URL" ./venv/bin/pytest -q` (11 pass).
- **Frontend:** the app shell runs — login, collapsible sidebar, theme toggle, role-gated nav to all 8 routes. The **page contents are still stubs** (Home / Submissions / OH Properties / Logs / Users / Tickets / Impersonator / Profile) — those are built in plans P3–P6 (`docs/superpowers/plans/`), not yet implemented.

## Tests / migrations
- The `tickets` table migration (`backend/migrations/2026-07-03-tickets.sql`) is already applied to the DB. Re-applying is idempotent.
- Two WhatsApp drop-migrations exist but are optional to apply.

# Deploying (frontend → Vercel, backend → Render)

The two halves deploy separately but the browser must see **one origin**: the SPA calls `/api/*` (relative), and Vercel rewrites those to the Render backend server-side (`frontend/vercel.json`). That keeps the session cookie first-party (SameSite=Lax) — no cross-site cookie, no CORS in the browser.

> **The #1 gotcha:** `VITE_API_BASE_URL` must be **`/api`** (or unset). If you set it to the Render URL in Vercel, the bundle calls Render **directly cross-origin** → CORS-preflight failures on every request. Same-origin is the whole design.

**Backend — Render** (service Root Directory = `backend`)
1. New → **Web Service** → pick this repo, set **Root Directory = `backend`** (Render then sees only that folder; a repo-root `render.yaml` would be ignored, so we configure by hand). Runtime Python; version comes from `backend/runtime.txt`.
2. **Build Command:** `pip install -r requirements.txt`
3. **Start Command:** `gunicorn "app:create_app()" --bind 0.0.0.0:$PORT` (the app is a factory — Render's default `gunicorn app:app` would crash). Health check path: `/api/health`.
4. Env vars: `FLASK_ENV=production` (→ Secure cookies), `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_ORIGIN` = your Vercel URL. Optional integrations: see `backend/.env.example`.
5. Note the hostname (e.g. `https://<service>.onrender.com`) → put it in the `/api` rewrite in `frontend/vercel.json`.

**Frontend — Vercel** (`frontend/vercel.json`)
1. Import the repo → **Root Directory = `frontend`** (Vite auto-detected → builds `dist`). Vercel reads `frontend/vercel.json` from that root.
2. Env vars: leave `VITE_API_BASE_URL` **unset** (code defaults to `/api` — see the gotcha above). Set the public `VITE_CLOUDINARY_*` / `VITE_COMET_*` vars (see `frontend/.env`) or those features stay off.
3. Confirm the `/api` rewrite destination in `frontend/vercel.json` is your real Render hostname, then **redeploy** (both `VITE_*` vars and `vercel.json` only take effect on a fresh build).
4. Set the backend's `FRONTEND_ORIGIN` on Render to the Vercel URL and redeploy — the CSRF Origin guard (`app.py`) and cookie both depend on it.
