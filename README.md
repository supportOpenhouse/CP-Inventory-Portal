# Openhouse CP Inventory Portal

Production app where Channel Partners (CPs) submit residential resale property
listings to Openhouse and admins / RMs / managers triage the pipeline,
send counter offers, schedule site visits via an external Forms app, and
approve or reject deals.

- **Frontend:** https://cp-inventory-portal.vercel.app
- **Backend:** https://cp-inventory-portal.onrender.com
- **Repo:** https://github.com/supportOpenhouse/CP-Inventory-Portal
- **Changelog:** see [CHANGELOG.md](CHANGELOG.md) for what shipped when

## Stack

| Layer | Tech |
|---|---|
| Frontend | Vite + React 18 (PWA, mobile-first) |
| Backend | Flask 3.1 + psycopg2 + PyJWT + gunicorn (Python 3.12) |
| Databases | PostgreSQL 15 on Neon — App DB (`openhouse-cp-portal`) and Properties DB (`properties`, read-only from this app) |
| Photos | Cloudinary (direct frontend upload via signed preset) |
| Email alerts | Gmail SMTP (Workspace App Password) |
| OTP SMS | Kaleyra (currently disabled in prod — phone-only login) |
| External integration | Forms app for visit scheduling |
| Hosting | Render (backend) · Vercel (frontend) |

## Pipeline stages

```
Unapproved → Submitted → Offer Given → Visit Scheduled → Visit Completed (terminal: green)
                                                       ↘ Price Rejected | Duplicate Rejected (terminal: red)
```

Removed in May 2026 simplification: `Evaluation`, `Closed`, `Rejected`. Status is a
plain VARCHAR with no DB CHECK constraint — adding/removing stages is a code change
plus an UPDATE migration for existing rows.

## Roles

| Role | Source | Scope |
|---|---|---|
| `cp` | `channel_partners` | own listings only |
| `rm` | `rms` table, `is_manager=FALSE` | admin UI, scoped to listings whose CP has `rm_id = me` |
| `manager` | `rms` table, `is_manager=TRUE` | admin UI, scoped to own + team's CPs |
| `admin` | `channel_partners.is_admin=TRUE` | admin UI, no scope filter |

## Local development

### Prerequisites

- Python 3.12 (`brew install python@3.12` on macOS)
- Node 20+ (this repo is tested on Node 25)
- A Neon branch of `openhouse-cp-portal` (instant copy-on-write — see Neon console
  → Branches → Create branch). **Do not point local at the prod App DB.** The
  Properties DB can stay pointed at prod; this app is read-only against it.

### Backend

```bash
cd backend
python3.12 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Fill in: DATABASE_URL (your branch URL), PROPERTIES_DATABASE_URL (prod, read-only),
# JWT_SECRET (any 48+ char random hex). Optional: GMAIL_*, FORMS_APP_URL, INTERNAL_API_KEY.
python app.py    # http://127.0.0.1:5000
```

> ⚠ **macOS port 5000 caveat:** AirPlay Receiver binds `[::1]:5000` on macOS,
> so the browser will hit AirPlay first if you use `http://localhost:5000`.
> The frontend `.env` is already pointed at the IPv4 literal `http://127.0.0.1:5000/api`
> to bypass this. Either keep that, or disable AirPlay Receiver in
> System Settings → General → AirDrop & Handoff.

### Frontend

```bash
cd frontend
npm install
cp env.example .env
# Set: VITE_API_BASE_URL=http://127.0.0.1:5000/api  (NOT localhost — see caveat above)
#      VITE_CLOUDINARY_CLOUD_NAME, VITE_CLOUDINARY_UPLOAD_PRESET (only needed for photo upload)
npm run dev      # http://localhost:5173
```

### Test accounts

| Phone | OTP | Role |
|---|---|---|
| `9555666059` | `000000` | admin |
| `9711382053` | `000000` | test CP |

Both are in `OTP_DEV_BYPASS_PHONES` by default. Other phones in the local DB
accept any 6-digit OTP since Kaleyra isn't configured.

### Mock Forms app (for testing visit-scheduling flows locally)

Visit scheduling hits the external Forms app. To exercise that path locally
without creating real visits, run the bundled stub:

```bash
cd backend
source venv/bin/activate
python scripts/mock_forms_app.py    # http://127.0.0.1:6000
```

Then in `backend/.env`:

```
FORMS_APP_URL=http://127.0.0.1:6000
INTERNAL_API_KEY=local-test-key
```

Restart the backend. Visit-scheduling now hits the mock instead of prod.

## Repo layout

```
backend/
  app.py                    Flask app factory, blueprint registration
  config.py                 Env vars, validated at startup
  db.py                     psycopg2 connection pools (App + Properties)
  auth.py                   JWT decode, @require_auth, @require_staff
  duplicate_check.py        Dup detection across 3 sources (properties, submissions, collated_data)
  public_id.py              OHLNC0042 / OHLGC0031 / OHLGZ0007 generator
  utils.py, services_*.py
  schema.sql                INITIAL schema (NOT current — see migrations/)
  migrations/               Forward migrations applied to prod, in chrono order
  scripts/                  Diagnostic + local-test helpers (gitignored OK)
  routes/
    health.py, auth_routes.py, meta.py, societies.py
    submissions.py          /api/submissions (CP-side CRUD, dup-check preview, withdraw, counter-offer-response)
    admin.py                /api/admin/* (large; staff surface)
    sync.py                 /api/sync/acquisition-prices (Apps Script callback)

frontend/
  src/
    main.jsx, App.jsx, api.js, auth.js, format.js, styles.js
    cloudinary.js, hooks/, contexts/, components/
    screens/
      Login.jsx, Dashboard.jsx, Chatbot.jsx, SubmissionDetailModal.jsx
      AddUnit/                  multi-step submit flow (CP & staff via mode='staff')
        index.jsx, Step1.jsx … Step4.jsx, SuccessScreen.jsx, DuplicateCard.jsx, …
      Admin/
        index.jsx               admin board container (city tabs, filters, bulk mode)
        BoardView.jsx           kanban-style stage columns
        TableView.jsx           tabular list
        DetailPanel.jsx         right-side drawer with full submission detail
        CpHistoryDrawer.jsx
        AddInventoryOnBehalf.jsx + CpSelector.jsx
        BulkScheduleVisitModal.jsx
        BulkReassignRmModal.jsx

CHANGELOG.md   per-push entries; latest at top
README.md      this file
```

## Conventions (read before editing)

1. **`git pull` before every edit.** This repo has been edited from multiple
   sessions and direct GitHub commits. Stale local state is the #1 cause of
   "fix didn't work".
2. **Run migrations BEFORE deploying matching backend code.** Render auto-deploys
   on push (when auto-deploy is wired) — if migrations lag, every request that
   touches the new column 500s in prod.
3. **Render free tier deploys can lag 2–5 min** plus 30–60s cold start. Don't
   conclude "fix didn't work" until the Render Events tab shows the new commit
   hash deployed and live.
4. **No CHECK constraint on `submissions.status`.** Adding/removing stages is
   a code change + an `UPDATE submissions SET status = ...` migration. Don't
   try to enforce the enum at the DB layer.
5. **Properties DB is READ-ONLY** from this backend's perspective. Use
   `get_props_conn()` for SELECTs only — never INSERT/UPDATE.
6. **CP-side and admin-side UI have separate visual scopes.** Many features
   (perfect-match, partial-match, withdrawn, unit-less, on-behalf) render
   differently for CPs vs. admins. Don't conflate them.
7. **Output as loose files, not zips.** Established as a workflow preference
   on Apr 27, 2026.
8. **Push approval is per-push, not blanket.** "Commit it" or "looks good"
   is review approval, not push approval — wait for an explicit "push".
9. **Keep [CHANGELOG.md](CHANGELOG.md) in sync with each push.** One entry per
   prod push, dated, latest at top.

## External services & dashboards

| Service | URL | What lives there |
|---|---|---|
| GitHub | https://github.com/supportOpenhouse/CP-Inventory-Portal | Code, branches, PRs |
| Render | https://dashboard.render.com | Backend host (`cp-inventory-portal-backend`); manual deploys, env vars, build logs |
| Vercel | https://vercel.com/dashboard | Frontend host (`cp-inventory-portal`); deploys, env vars |
| Neon | https://console.neon.tech | App DB + Properties DB; SQL Editor for migrations and ad-hoc queries |
| Cloudinary | https://cloudinary.com | Photo storage; upload preset `cp_unit_photos` |
| Kaleyra | Kaleyra HQ | OTP SMS (currently `OTP_ENABLED=false` in prod) |

Health check: `curl https://cp-inventory-portal.onrender.com/api/health` should
return `{"ok":true,"databases":{"app":"ok","properties":"ok"}}`.

## Deploy procedure

1. **Migration first** if any — Neon SQL Editor on the prod App DB,
   apply the SQL from `backend/migrations/<latest>.sql`. The migrations are
   idempotent (`ADD COLUMN IF NOT EXISTS` etc.) so re-runs are safe.
2. **Push to `origin/main`.** That triggers Render auto-deploy and Vercel
   auto-deploy (when those are working). If auto-deploy doesn't fire, use:
   - Render: `cp-inventory-portal-backend` → top-right **Manual Deploy** → **Deploy latest commit**
   - Vercel: project → Deployments → click `…` on the latest → **Redeploy**
3. **Verify on prod:** `/api/health` returns 200 with both DBs connected;
   open the live site, log in, exercise the new feature once.
4. **Update [CHANGELOG.md](CHANGELOG.md)** as part of the same push.

## Open / known limitations

- **Forms-app webhook is one-way.** When a visit completes/cancels in the
  Forms app, our backend doesn't get notified — admin moves the status
  manually. Future: `POST /api/external/visit-status`.
- **Field-exec dropdown isn't city-filtered.** All `properties.users` with
  `can_visit=TRUE` show up regardless of which city the listing is in.
  Needs a `city_id` column on `properties.users` (cross-team work).
- **Counter-offer 2nd round** isn't supported. After CP rejects, status
  goes to `Price Rejected` and the flow ends.
- **Render auto-deploy may not be wired.** Recent pushes have required
  Manual Deploy from the dashboard. Verify in Settings → Build & Deploy
  → Auto-Deploy and the GitHub webhook list.
- **Per-listing `assigned_rm_id`** column exists on `submissions` but is
  legacy (it referenced `channel_partners` when RMs lived there). The
  canonical RM relationship is `channel_partners.rm_id → rms.id`.

## More

- **HANDOVER.md** — full architectural deep-dive (lives outside the repo;
  ~2100 lines). Search Cmd+F for the topic you need.
- **Anything else** — search the codebase. There are extensive inline
  comments explaining design decisions.
