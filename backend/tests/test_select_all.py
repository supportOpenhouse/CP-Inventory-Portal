"""Tests for `?all=true` (Select all) and the set-based bulk-status rewrite.

Rows are isolated by a unique society_name and found via the `search` param
(which does `s.society_name ILIKE %s`). Strictly self-cleaning: every row this
module creates is deleted in the fixture teardown, in reverse FK order —
including the `activity_log` rows that bulk-status calls write, which are
scoped by BOTH an id watermark recorded at fixture setup AND the fixture's
own admin actor id, so only rows this run's tests actually caused are
removed — never a real admin's bulk-status action that happens to land
during the ~60s test window.
"""
import os
import time

import psycopg2
import psycopg2.extras
import pytest

from tests.conftest import requires_db

_DSN = os.getenv("TEST_DATABASE_URL") or os.getenv("DATABASE_URL")


@pytest.fixture()
def many(graph):
    """Insert 20 'Submitted' submissions under the fixture CP, uniquely tagged."""
    conn = psycopg2.connect(_DSN, cursor_factory=psycopg2.extras.RealDictCursor)
    tag = f"pytest-all-{int(time.time() * 1000)}"
    ids = []
    # Bound before the try so a failed watermark SELECT leaves this None —
    # never unbound. If we let the name stay unbound and the SELECT below
    # raised, `finally` would hit a NameError and mask whatever exception
    # actually failed. Must default to None, not 0: 0 would make the
    # `is not None` guard below pass and turn the teardown delete into a
    # blanket sweep of every status_change_bulk row ever written.
    activity_log_watermark = None
    try:
        with conn:
            with conn.cursor() as cur:
                # Watermark so teardown only removes activity_log rows this
                # fixture's tests caused (bulk-status writes one per call),
                # never a blanket delete of the audit table.
                cur.execute("SELECT COALESCE(max(id), 0) AS max_id FROM activity_log")
                activity_log_watermark = cur.fetchone()["max_id"]
                for _ in range(20):
                    cur.execute(
                        "INSERT INTO submissions (cp_id, society_name, status) "
                        "VALUES (%s, %s, 'Submitted') RETURNING id",
                        (graph["cp"], tag),
                    )
                    ids.append(cur.fetchone()["id"])
        yield {"tag": tag, "ids": ids, "graph": graph}
    finally:
        with conn:
            with conn.cursor() as cur:
                # Reverse FK order: events reference submissions.
                cur.execute("DELETE FROM submission_events WHERE submission_id = ANY(%s)", (ids,))
                cur.execute("DELETE FROM submissions WHERE id = ANY(%s)", (ids,))
                # bulk-status calls each write one activity_log row
                # (action='status_change_bulk'); clean up only the ones
                # created after our watermark AND written by this fixture's
                # own admin actor (activity_log.actor_id/actor_type — see
                # activity_log.py's _actor_from_g, which stamps the JWT's
                # cp_id/'admin' for this fixture's admin token). Scoping by
                # id alone is time-scoped, not test-scoped: these tests hit
                # a real, shared database, so a real admin's bulk action
                # landing in the same ~60s window would otherwise also get
                # deleted here. Skip entirely if the watermark SELECT above
                # never ran/succeeded (see the None default above).
                if activity_log_watermark is not None:
                    cur.execute(
                        "DELETE FROM activity_log WHERE id > %s AND action = 'status_change_bulk' "
                        "AND actor_id = %s AND actor_type = 'admin'",
                        (activity_log_watermark, graph["admin"]),
                    )
        conn.close()


@requires_db
def test_all_true_returns_every_matching_row(client, many):
    h = many["graph"]["headers"]["admin"]
    tag = many["tag"]

    paged = client.get(f"/api/admin/submissions?search={tag}&limit=5", headers=h)
    assert paged.status_code == 200
    assert len(paged.get_json()["submissions"]) == 5

    everything = client.get(f"/api/admin/submissions?all=true&search={tag}", headers=h)
    assert everything.status_code == 200
    assert len(everything.get_json()["submissions"]) == 20


@requires_db
def test_all_true_ignores_limit(client, many):
    h = many["graph"]["headers"]["admin"]
    r = client.get(f"/api/admin/submissions?all=true&limit=5&search={many['tag']}", headers=h)
    assert r.status_code == 200
    assert len(r.get_json()["submissions"]) == 20


@requires_db
def test_bulk_status_counts_and_from_status(client, many):
    """Set-based rewrite must reproduce the old loop's counts exactly."""
    h = many["graph"]["headers"]["admin"]
    ids = many["ids"]
    conn = psycopg2.connect(_DSN, cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        with conn:
            with conn.cursor() as cur:
                # ids[0]: already at target -> skipped
                cur.execute("UPDATE submissions SET status='Closure' WHERE id=%s", (ids[0],))
                # ids[1]: AUTO_ONLY stage -> skipped
                cur.execute("UPDATE submissions SET status='Offer' WHERE id=%s", (ids[1],))
                # ids[2]: soft-deleted -> out of scope
                cur.execute("UPDATE submissions SET deleted_at=NOW() WHERE id=%s", (ids[2],))

        r = client.post("/api/admin/submissions/bulk-status",
                        json={"ids": ids + [99999999], "status": "Closure"}, headers=h)
        assert r.status_code == 200
        body = r.get_json()
        # 20 rows: 1 already-at-target + 1 auto-only = skipped 2; 1 deleted + 1
        # bogus id = out of scope 2; remaining 17 updated.
        assert body["updated"] == 17
        assert body["skipped_same_status"] == 2
        assert body["out_of_scope_or_deleted"] == 2

        with conn:
            with conn.cursor() as cur:
                cur.execute("SELECT status FROM submissions WHERE id=%s", (ids[1],))
                assert cur.fetchone()["status"] == "Offer"   # auto-only untouched
                # from_status must be the PRE-update value, not the new one.
                cur.execute(
                    "SELECT from_status, to_status FROM submission_events "
                    "WHERE submission_id=%s AND kind='status_change'", (ids[3],))
                ev = cur.fetchone()
                assert ev["from_status"] == "Submitted"
                assert ev["to_status"] == "Closure"
    finally:
        conn.close()


@requires_db
def test_bulk_status_null_status_row_is_updated_not_skipped(client, many):
    """A NULL-status row must be UPDATEd, not miscounted as skipped_same_status.

    Guards the `s.status IS NULL OR` half of the `target` CTE's WHERE clause
    (admin.py). Python's `None in AUTO_ONLY_STAGES` is False, so the old
    per-row loop treated a NULL-status row as eligible and updated it. A bare
    `NULL <> ALL(...)` evaluates to NULL, which would drop the row from
    `target` and silently reclassify it as skipped -- this test fails if that
    guard is removed.
    """
    h = many["graph"]["headers"]["admin"]
    ids = many["ids"]
    conn = psycopg2.connect(_DSN, cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute("UPDATE submissions SET status=NULL WHERE id=%s", (ids[0],))

        r = client.post("/api/admin/submissions/bulk-status",
                        json={"ids": ids, "status": "Closure"}, headers=h)
        assert r.status_code == 200
        body = r.get_json()
        # All 20 rows are eligible for the 'Submitted'/'Closure' transition
        # (ids[0] is NULL instead of 'Submitted', but that's still eligible):
        # none already at target, none auto-only, none deleted -> all 20
        # updated, nothing skipped or out of scope.
        assert body["updated"] == 20
        assert body["skipped_same_status"] == 0
        assert body["out_of_scope_or_deleted"] == 0

        with conn:
            with conn.cursor() as cur:
                cur.execute("SELECT status FROM submissions WHERE id=%s", (ids[0],))
                assert cur.fetchone()["status"] == "Closure"
                cur.execute(
                    "SELECT from_status, to_status FROM submission_events "
                    "WHERE submission_id=%s AND kind='status_change'", (ids[0],))
                ev = cur.fetchone()
                assert ev["from_status"] is None
                assert ev["to_status"] == "Closure"
    finally:
        conn.close()


@requires_db
def test_bulk_status_rejects_over_5000(client, graph):
    r = client.post("/api/admin/submissions/bulk-status",
                    json={"ids": list(range(1, 5002)), "status": "Closure"},
                    headers=graph["headers"]["admin"])
    assert r.status_code == 400
    assert "5000" in r.get_json()["error"]


@requires_db
def test_bulk_status_accepts_over_200(client, many):
    """The old 200 cap must be gone."""
    r = client.post("/api/admin/submissions/bulk-status",
                    json={"ids": many["ids"] + list(range(900000, 900300)), "status": "Closure"},
                    headers=many["graph"]["headers"]["admin"])
    assert r.status_code == 200
