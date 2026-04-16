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
    furnishing       VARCHAR(50),
    exit_facing      VARCHAR(50),
    balcony_facing   VARCHAR(50),
    balcony_view     VARCHAR(100),
    parking          VARCHAR(50),
    extra_rooms      JSONB DEFAULT '[]'::jsonb,  -- e.g. ["Puja Room", "Study Room"]
    registry_status  VARCHAR(20),
    asking_price     BIGINT,
    closing_price    BIGINT,
    seller_name      VARCHAR(200),
    seller_phone     VARCHAR(20),
    status           VARCHAR(30) DEFAULT 'Submitted',
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


-- ========== 5. faqs ==========
CREATE TABLE IF NOT EXISTS faqs (
    id             SERIAL PRIMARY KEY,
    category       VARCHAR(50),
    question       VARCHAR(500) NOT NULL UNIQUE,
    answer         TEXT NOT NULL,
    display_order  INTEGER DEFAULT 0,
    is_active      BOOLEAN DEFAULT TRUE,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_faq_active ON faqs(is_active, display_order);

-- Seed 15 starter FAQs — edit directly in Neon SQL Editor later
INSERT INTO faqs (category, question, answer, display_order) VALUES
('About',      'What is Openhouse?',
               'Openhouse is India''s residential resale platform. We buy out and then resell pre-owned homes in NCR, giving sellers a fast, certain closure and channel partners a reliable commission.',
               1),
('Process',    'What happens after I submit a unit?',
               'Our evaluation team reviews the unit within 48 hours. If it''s a fit, we share an offer. If you accept on the seller''s behalf, we schedule a site visit and close the deal.',
               2),
('Process',    'How long does it take to get an offer?',
               'We aim to share an offer within 48 hours of submission. Complex units may take up to 5 working days.',
               3),
('Form',       'What info do I need to submit a unit?',
               'Society is mandatory. Tower, unit number, floor, sqft, BHK, facings, parking, registry status, asking price, and closing price are helpful but optional.',
               4),
('Commission', 'What commission does Openhouse pay CPs?',
               'Commission is paid on successful closure. The exact percentage is shared by your RM based on the deal structure.',
               5),
('Commission', 'When is commission paid?',
               'Within 7 working days of the buyer''s token payment being received.',
               6),
('Coverage',   'Which cities does Openhouse operate in?',
               'Currently Noida (including Greater Noida), Gurugram, and Ghaziabad.',
               7),
('Duplicate',  'What if my unit is already in Openhouse''s database?',
               'If the society + tower + unit is already with us, the portal will flag it. For partial matches (society or tower only), please contact your Openhouse representative before proceeding.',
               8),
('Edit',       'How do I update a submitted unit?',
               'You can''t edit directly from the portal yet. Message your RM with the submission ID and the change needed.',
               9),
('Seller',     'Can my seller contact Openhouse directly?',
               'Yes — but please loop in your RM first so the lead is correctly attributed to you for commission.',
               10),
('Seller',     'What documents does the seller need?',
               'Allotment letter or registry, chain of documents, latest maintenance bill, and a photo ID. Your RM will share the full list.',
               11),
('Legal',      'Does Openhouse handle registration and legal work?',
               'Yes — our in-house legal team handles due diligence, registry, and handover paperwork end-to-end.',
               12),
('Pricing',    'What is the difference between asking price and closing price?',
               'Asking price is what the seller advertises. Closing price is what they will actually accept. Giving both helps us shortlist faster.',
               13),
('Support',    'Who do I contact for issues?',
               'Your RM is the first point of contact (numbers shown on the login page). For portal bugs, WhatsApp +91 95556 66059.',
               14),
('Team',       'Can I add a teammate as another CP?',
               'Yes — your RM can onboard additional CPs from your company. Send their name, phone, and email to your RM.',
               15)
ON CONFLICT (question) DO NOTHING;


-- ========== Final verification ==========
-- This block should print row counts. Expected after first run:
--   cities: 3 | channel_partners: 1 | societies: 0 | submissions: 0 | faqs: 15
SELECT 'cities'           AS tbl, COUNT(*) AS rows FROM cities
UNION ALL
SELECT 'channel_partners',         COUNT(*)        FROM channel_partners
UNION ALL
SELECT 'societies',                COUNT(*)        FROM societies
UNION ALL
SELECT 'submissions',              COUNT(*)        FROM submissions
UNION ALL
SELECT 'faqs',                     COUNT(*)        FROM faqs
ORDER BY tbl;
