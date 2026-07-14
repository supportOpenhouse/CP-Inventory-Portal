"""The ported app must import, build, and answer /api/health against the real DB."""
import os
import pytest

from app import create_app


@pytest.fixture()
def client():
    app = create_app()
    app.testing = True
    return app.test_client()


def test_app_factory_builds():
    app = create_app()
    assert app is not None


@pytest.mark.skipif(not os.getenv("DATABASE_URL"), reason="needs DATABASE_URL")
def test_health_ok(client):
    resp = client.get("/api/health")
    assert resp.status_code in (200, 503)          # 503 only if a pool is down
    body = resp.get_json()
    assert body["databases"]["app"] == "ok"        # app DB must be reachable
