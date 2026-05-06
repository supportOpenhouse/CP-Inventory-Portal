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
    status           VARCHAR(30) DEFAULT 'Submitted',
    collated_match   BOOLEAN     DEFAULT FALSE NOT NULL,  -- partial match from external-scraper collated_data; admin UI highlights this in Unapproved queue
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


-- ========== Final verification ==========
-- This block should print row counts. Expected after first run:
--   cities: 3 | channel_partners: 1 | societies: 0 | submissions: 0
SELECT 'cities'           AS tbl, COUNT(*) AS rows FROM cities
UNION ALL
SELECT 'channel_partners',         COUNT(*)        FROM channel_partners
UNION ALL
SELECT 'societies',                COUNT(*)        FROM societies
UNION ALL
SELECT 'submissions',              COUNT(*)        FROM submissions
ORDER BY tbl;
