-- Saved filter presets for the Submissions board.
--
-- Shape is deliberately one ROW PER USER with three numbered JSONB slots (as
-- specified), rather than a row per preset. Consequence to know about: raising
-- the 3-preset cap later needs a migration here, not just a constant change.
--
-- `sequence` holds the slot numbers in left-to-right display order, e.g.
-- {2,1,3} = slot 2 renders leftmost. `priority` names the slot that is
-- auto-applied when the user's local filter store has expired. Dragging a
-- preset to the leftmost position IS what makes it the priority one, so the
-- two columns are kept in lockstep by ufp_priority_is_first below.

CREATE TABLE IF NOT EXISTS user_filter_presets (
    id            SERIAL PRIMARY KEY,

    -- Polymorphic owner, same pattern as submission_events.actor_cp_id /
    -- actor_rm_id: staff (rm/manager/viewer) live in `rms`, admins in
    -- `channel_partners`. Exactly one is set.
    owner_rm_id   INTEGER REFERENCES rms(id) ON DELETE CASCADE,
    owner_cp_id   INTEGER REFERENCES channel_partners(id) ON DELETE CASCADE,

    -- Each slot: {"name": "Hot Noida leads", "filters": { ... }} or NULL when empty.
    preset1       JSONB,
    preset2       JSONB,
    preset3       JSONB,

    "sequence"    SMALLINT[] NOT NULL DEFAULT '{1,2,3}',
    priority      SMALLINT,

    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ufp_one_owner
        CHECK ((owner_rm_id IS NULL) <> (owner_cp_id IS NULL)),

    -- `sequence` must be a permutation of the three slots — no dupes, no gaps.
    -- @> and <@ together mean "contains exactly these values"; the length
    -- check is what stops {1,1,2,3} slipping through both containment tests.
    CONSTRAINT ufp_sequence_shape CHECK (
        array_length("sequence", 1) = 3
        AND "sequence" @> ARRAY[1,2,3]::SMALLINT[]
        AND "sequence" <@ ARRAY[1,2,3]::SMALLINT[]
    ),

    -- THE constraint: the priority preset is always the first in `sequence`.
    -- Postgres arrays are 1-indexed, so sequence[1] is the leftmost slot.
    CONSTRAINT ufp_priority_is_first
        CHECK (priority IS NULL OR priority = "sequence"[1]),

    -- ...and it must point at a slot that actually holds a preset, otherwise
    -- "apply my priority filter" would resolve to nothing on page load.
    CONSTRAINT ufp_priority_slot_filled CHECK (
        priority IS NULL
        OR (priority = 1 AND preset1 IS NOT NULL)
        OR (priority = 2 AND preset2 IS NOT NULL)
        OR (priority = 3 AND preset3 IS NOT NULL)
    )
);

-- One row per user. Partial uniques because only one owner column is ever set.
CREATE UNIQUE INDEX IF NOT EXISTS ufp_owner_rm_uniq
    ON user_filter_presets (owner_rm_id) WHERE owner_rm_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ufp_owner_cp_uniq
    ON user_filter_presets (owner_cp_id) WHERE owner_cp_id IS NOT NULL;
