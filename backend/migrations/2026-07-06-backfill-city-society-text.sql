-- Backfill free-text city/society columns from their *_id FKs.
-- master_societies switched matching to text city/society; this populates the
-- text columns for legacy rows that only had city_id/society_id set.
--
-- Idempotent + safe: only fills rows where the text col is NULL/blank AND the
-- id is present, so already-populated values are left untouched. Wrapped in a
-- transaction — nothing commits if any statement errors.
--
-- To make the *_id the sole source of truth (OVERWRITE existing text too),
-- delete the "(col IS NULL OR btrim(col) = '')" line from each statement.

BEGIN;

-- submissions.city  <- cities.name
UPDATE submissions s
SET    city = c.name
FROM   cities c
WHERE  s.city_id = c.id
  AND  s.city_id IS NOT NULL
  AND  (s.city IS NULL OR btrim(s.city) = '');

-- submissions.society <- societies.name
UPDATE submissions s
SET    society = so.name
FROM   societies so
WHERE  s.society_id = so.id
  AND  s.society_id IS NOT NULL
  AND  (s.society IS NULL OR btrim(s.society) = '');

-- channel_partners.city <- cities.name
UPDATE channel_partners cp
SET    city = c.name
FROM   cities c
WHERE  cp.city_id = c.id
  AND  cp.city_id IS NOT NULL
  AND  (cp.city IS NULL OR btrim(cp.city) = '');

-- rms.city <- cities.name
UPDATE rms r
SET    city = c.name
FROM   cities c
WHERE  r.city_id = c.id
  AND  r.city_id IS NOT NULL
  AND  (r.city IS NULL OR btrim(r.city) = '');

-- societies.city <- cities.name
UPDATE societies so
SET    city = c.name
FROM   cities c
WHERE  so.city_id = c.id
  AND  so.city_id IS NOT NULL
  AND  (so.city IS NULL OR btrim(so.city) = '');

-- society_rm_mappings.society <- societies.name
UPDATE society_rm_mappings m
SET    society = so.name
FROM   societies so
WHERE  m.society_id = so.id
  AND  m.society_id IS NOT NULL
  AND  (m.society IS NULL OR btrim(m.society) = '');

COMMIT;

-- Sanity check (run after COMMIT): rows still empty despite an id present.
-- SELECT 'submissions.city'    AS col, count(*) FROM submissions        WHERE city_id    IS NOT NULL AND (city    IS NULL OR btrim(city)   ='')
-- UNION ALL SELECT 'submissions.society',   count(*) FROM submissions        WHERE society_id IS NOT NULL AND (society IS NULL OR btrim(society)='')
-- UNION ALL SELECT 'channel_partners.city', count(*) FROM channel_partners    WHERE city_id    IS NOT NULL AND (city    IS NULL OR btrim(city)   ='')
-- UNION ALL SELECT 'rms.city',              count(*) FROM rms                 WHERE city_id    IS NOT NULL AND (city    IS NULL OR btrim(city)   ='')
-- UNION ALL SELECT 'societies.city',        count(*) FROM societies           WHERE city_id    IS NOT NULL AND (city    IS NULL OR btrim(city)   ='')
-- UNION ALL SELECT 'society_rm_mappings.society', count(*) FROM society_rm_mappings WHERE society_id IS NOT NULL AND (society IS NULL OR btrim(society)='');
