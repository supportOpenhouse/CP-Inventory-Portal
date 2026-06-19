-- ============================================================
-- Openhouse CP Inventory Portal — Initial Schema
-- Database: openhouse-cp-portal (Neon, ap-south-1)
-- Run in Neon SQL Editor. Safe to re-run (uses IF NOT EXISTS / ON CONFLICT).
-- ============================================================

-- Sanity check: confirm you're connected to the right database
SELECT current_database() AS connected_db, now() AS server_time;


-- ========== 1. cities ==========
CREATE TABLE IF NOT EXISTS cities (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(50) NOT NULL UNIQUE,
    rm_name      VARCHAR(100),
    rm_phone     VARCHAR(20),
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO cities (name, rm_name, rm_phone) VALUES
    ('Noida',     'Abhishek', '+91 94524 41498'),
    ('Gurgaon',   'Shashank', '+91 92056 58886'),
    ('Ghaziabad', 'Animesh',  '+91 98108 26481')
ON CONFLICT (name) DO NOTHING;


-- ========== 2. channel_partners ==========
CREATE TABLE IF NOT EXISTS channel_partners (
    id             SERIAL PRIMARY KEY,
    cp_code        VARCHAR(20) UNIQUE NOT NULL,
    name           VARCHAR(200) NOT NULL,
    phone          VARCHAR(15) NOT NULL,
    company        VARCHAR(200),
    city_id        INTEGER REFERENCES cities(id),
    micro_markets  JSONB DEFAULT '[]'::jsonb,
    is_admin       BOOLEAN DEFAULT FALSE,
    is_active      BOOLEAN DEFAULT TRUE,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    last_login     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cp_phone ON channel_partners(phone);
CREATE INDEX IF NOT EXISTS idx_cp_city  ON channel_partners(city_id);

-- Seed admin account (phone 9555666059, bypasses nothing per new rules — is_admin kept for future use)
INSERT INTO channel_partners (cp_code, name, phone, company, city_id, is_admin)
VALUES ('ADMIN', 'Admin', '9555666059', 'Openhouse', NULL, TRUE)
ON CONFLICT (cp_code) DO NOTHING;


-- ========== 3. societies ==========
CREATE TABLE IF NOT EXISTS societies (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(200) NOT NULL,
    city_id    INTEGER REFERENCES cities(id) NOT NULL,
    locality   VARCHAR(200),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (name, city_id)
);

CREATE INDEX IF NOT EXISTS idx_society_city     ON societies(city_id);
CREATE INDEX IF NOT EXISTS idx_society_name     ON societies(name);
CREATE INDEX IF NOT EXISTS idx_society_locality ON societies(locality);


-- ========== 4. submissions ==========
CREATE TABLE IF NOT EXISTS submissions (
    id               SERIAL PRIMARY KEY,
    cp_id            INTEGER REFERENCES channel_partners(id) NOT NULL,
    society_id       INTEGER REFERENCES societies(id),
    society_name     VARCHAR(200) NOT NULL,    -- denormalized for fast display
    tower            VARCHAR(50),              -- optional (CPs may not know)
    unit_no          VARCHAR(50),              -- optional
    floor            VARCHAR(20),              -- optional, kept as string (handles "G", "B1")
    sqft             INTEGER,                  -- optional
    bhk              VARCHAR(20),              -- optional
    occupancy_status VARCHAR(20),                  -- 'Vacant' | 'Occupied' (replaces legacy registry_status)
    registry_status  VARCHAR(20),                  -- DEPRECATED; kept for back-compat, no longer written
    asking_price     BIGINT,
    seller_name      VARCHAR(200),
    seller_phone     VARCHAR(20),
    status           VARCHAR(30) DEFAULT 'Submitted',          -- one of the 8 board stages (Unapproved/Submitted/Visit Scheduled/Visit Completed/Offer/Closure/Price Rejected/Rejected); UI displays 'Offer' as "Offer Given"
    status_reason    VARCHAR(40),                              -- sub-category for the current status; for status='Rejected' it is one of: Cancelled Post Token, Dead - Legal, Dead - Not Interested, Dead - Sold, Duplicacy, Hold, OH Rejected, Seller Rejected. Staff-only display.
    real_status      VARCHAR(40),                              -- DEPRECATED, superseded by status_reason; no longer read/written. Kept temporarily for audit. See migrations/2026-05-25-status-reason-and-rename-rejected.sql
    collated_match   BOOLEAN     DEFAULT FALSE NOT NULL,  -- partial match from the external `inventory` table (separate DB); admin UI highlights this in Unapproved queue
    match_details    JSONB       NOT NULL DEFAULT '[]'::jsonb,  -- the actual matched records behind the badges (source/id/society/tower/unit/floor/bhk/area); see migrations/2026-06-18-match-details.sql
    match_scanned_at TIMESTAMPTZ,                                -- when backfill_match_details.py last scanned this row; lets re-runs skip it. See migrations/2026-06-19-match-scanned-at.sql
    videos           JSONB       NOT NULL DEFAULT '[]'::jsonb,  -- CP-shared videos as {public_id, url} (Cloudinary); photos reuse the `photos` array. See migrations/2026-06-18-cp-media-and-visit-request.sql
    requested_visit_date DATE,                                  -- CP-requested visit slot (request only; does not change stage)
    requested_visit_slot TEXT,                                  -- 'morning' | 'afternoon' | 'evening'
    requested_rm_id      INTEGER,                               -- RM the CP requested for the visit (rms.id; same-city)
    visit_requested_at   TIMESTAMPTZ,
    submitted_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sub_cp        ON submissions(cp_id);
CREATE INDEX IF NOT EXISTS idx_sub_society   ON submissions(society_id);
CREATE INDEX IF NOT EXISTS idx_sub_submitted ON submissions(submitted_at DESC);

-- Auto-update updated_at on any row change
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS submissions_set_updated_at ON submissions;
CREATE TRIGGER submissions_set_updated_at
BEFORE UPDATE ON submissions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ========== 5. society_rm_mappings ==========
-- Per-society RM routing override. When a new submission is created, the
-- resolver consults this table first; if no row exists, it falls back to
-- the first active RM in the society's city. Admins write rows here from
-- the listing-RM UI when they pick "apply to future submissions of this
-- society". Assumes the `rms` table is already present (added via a prior
-- migration — this initial schema file pre-dates it).
CREATE TABLE IF NOT EXISTS society_rm_mappings (
    society_id  INTEGER PRIMARY KEY REFERENCES societies(id) ON DELETE CASCADE,
    rm_id       INTEGER NOT NULL REFERENCES rms(id),
    set_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_society_rm_rm ON society_rm_mappings(rm_id);


-- ========== Final verification ==========
-- This block should print row counts. Expected after first run:
--   cities: 3 | channel_partners: 1 | societies: 0 | submissions: 0 | society_rm_mappings: 0
SELECT 'cities'              AS tbl, COUNT(*) AS rows FROM cities
UNION ALL
SELECT 'channel_partners',           COUNT(*)        FROM channel_partners
UNION ALL
SELECT 'societies',                  COUNT(*)        FROM societies
UNION ALL
SELECT 'submissions',                COUNT(*)        FROM submissions
UNION ALL
SELECT 'society_rm_mappings',        COUNT(*)        FROM society_rm_mappings
ORDER BY tbl;
