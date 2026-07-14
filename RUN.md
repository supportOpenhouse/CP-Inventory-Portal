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

The two halves deploy separately but the browser sees **one origin**: the SPA calls `/api/*` (relative), and Vercel rewrites those to the Render backend server-side (`frontend/vercel.json`). That keeps the session cookie first-party (SameSite=Lax) — no cross-site cookie, no CORS in the browser.

**Backend — Render** (`render.yaml`)
1. Render Dashboard → New → **Blueprint** → pick this repo. It reads `render.yaml` (rootDir `backend`, factory start command, `/api/health` check).
2. Set the `sync:false` env vars when prompted: `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_ORIGIN` (= your Vercel URL). Add optional integration vars from `backend/.env.example` as needed.
3. Default hostname: `https://cp-inventory-portal-api.onrender.com`. **If your service name differs, update the `/api` rewrite in `frontend/vercel.json` to match.**

**Frontend — Vercel** (`frontend/vercel.json`)
1. Import the repo → set **Root Directory = `frontend`** (Vite is auto-detected → builds `dist`).
2. Env vars: `VITE_API_BASE_URL` can be left unset (code defaults to `/api`). Set the public `VITE_CLOUDINARY_*` and `VITE_COMET_*` vars (see `frontend/.env`) or those features stay off.
3. After the first deploy, set the backend's `FRONTEND_ORIGIN` on Render to the Vercel URL and redeploy — the CSRF Origin guard (`app.py`) and cookie both depend on it.
