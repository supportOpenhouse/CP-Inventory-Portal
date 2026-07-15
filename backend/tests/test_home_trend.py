"""Tests for GET /api/admin/submissions/by-date (Home's trend chart).

Read-only against the fixture graph — creates no rows of its own, so there is
nothing to clean up.
"""
from tests.conftest import requires_db


def _points(client, headers, qs=""):
    r = client.get(f"/api/admin/submissions/by-date{qs}", headers=headers)
    assert r.status_code == 200, r.get_json()
    return r.get_json()["points"]


@requires_db
def test_by_date_clamps_days(client, graph):
    """days is clamped to [1, 90]; junk falls back to the 30-day default."""
    h = graph["headers"]["admin"]
    assert len(_points(client, h)) == 30                    # default
    assert len(_points(client, h, "?days=90")) == 90
    assert len(_points(client, h, "?days=500")) == 90       # clamped to max
    assert len(_points(client, h, "?days=0")) == 1          # clamped to min
    assert len(_points(client, h, "?days=abc")) == 30       # unparseable -> default


@requires_db
def test_by_date_zero_fills_every_day(client, graph):
    """Every day in the window is present, oldest first, with no gaps.

    The aggregate only returns days that HAVE rows. Without the zero-fill the
    polyline joins across a quiet stretch and renders it as a smooth slope —
    so a missing day is a correctness bug, not a cosmetic one.
    """
    pts = _points(client, graph["headers"]["admin"], "?days=30")
    dates = [p["date"] for p in pts]

    assert len(pts) == 30
    assert len(set(dates)) == 30            # no duplicate days
    assert dates == sorted(dates)           # oldest first
    assert all(isinstance(p["count"], int) and p["count"] >= 0 for p in pts)

    # Consecutive: each date is exactly one day after the previous.
    from datetime import date, timedelta
    parsed = [date.fromisoformat(d) for d in dates]
    assert all(b - a == timedelta(days=1) for a, b in zip(parsed, parsed[1:]))


@requires_db
def test_by_date_requires_staff(client):
    """Unauthenticated callers get no data."""
    r = client.get("/api/admin/submissions/by-date")
    assert r.status_code in (401, 403)
