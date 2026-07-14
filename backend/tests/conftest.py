"""DB-backed test fixtures. Gated behind RUN_DB_TESTS=1; strictly self-cleaning.

Builds a throwaway staff graph in whatever DB TEST_DATABASE_URL (preferred) or
DATABASE_URL points at: a manager + two RMs (rm reports to manager, rm2 does
not), an admin, a CP owned by rm, and one submission. Everything is deleted in
teardown (reverse FK order). Never touches rows it didn't create.
"""
import os
import time

import jwt
import psycopg2
import psycopg2.extras
import pytest

from app import create_app
from config import Config

_DSN = os.getenv("TEST_DATABASE_URL") or os.getenv("DATABASE_URL")
_GATED = os.getenv("RUN_DB_TESTS") == "1" and bool(_DSN)
requires_db = pytest.mark.skipif(not _GATED, reason="set RUN_DB_TESTS=1 and TEST_DATABASE_URL")


def _token(claims: dict) -> str:
    return jwt.encode({**claims, "iat": int(time.time())}, Config.JWT_SECRET, algorithm="HS256")


@pytest.fixture()
def client():
    app = create_app()
    app.testing = True
    return app.test_client()


@pytest.fixture()
def graph():
    """Insert a throwaway staff/submission graph; yield ids + auth headers; clean up."""
    conn = psycopg2.connect(_DSN, cursor_factory=psycopg2.extras.RealDictCursor)
    ids = {}
    tag = f"pytest-{int(time.time())}"
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO rms (name, phone, is_manager, is_viewer) "
                    "VALUES (%s, %s, TRUE, FALSE) RETURNING id", (f"{tag}-mgr", "+91 9000000001"))
                ids["manager"] = cur.fetchone()["id"]
                cur.execute(
                    "INSERT INTO rms (name, phone, is_manager, is_viewer, manager_id) "
                    "VALUES (%s, %s, FALSE, FALSE, %s) RETURNING id",
                    (f"{tag}-rm", "+91 9000000002", ids["manager"]))
                ids["rm"] = cur.fetchone()["id"]
                cur.execute(
                    "INSERT INTO rms (name, phone, is_manager, is_viewer) "
                    "VALUES (%s, %s, FALSE, FALSE) RETURNING id", (f"{tag}-rm2", "+91 9000000003"))
                ids["rm2"] = cur.fetchone()["id"]
                cur.execute(
                    "INSERT INTO channel_partners (cp_code, name, phone, is_admin, is_active) "
                    "VALUES (%s, %s, %s, TRUE, TRUE) RETURNING id",
                    (f"{tag}-A", f"{tag}-admin", "9000000004"))
                ids["admin"] = cur.fetchone()["id"]
                cur.execute(
                    "INSERT INTO channel_partners (cp_code, name, phone, is_admin, is_active, rm_id) "
                    "VALUES (%s, %s, %s, FALSE, TRUE, %s) RETURNING id",
                    (f"{tag}-C", f"{tag}-cp", "9000000005", ids["rm"]))
                ids["cp"] = cur.fetchone()["id"]
                cur.execute(
                    "INSERT INTO submissions (cp_id, society_name, status) "
                    "VALUES (%s, %s, 'Submitted') RETURNING id, public_id",
                    (ids["cp"], f"{tag}-society"))
                row = cur.fetchone()
                ids["submission"] = row["id"]
                ids["public_id"] = row.get("public_id")
        ids["headers"] = {
            "admin": {"Authorization": "Bearer " + _token(
                {"cp_id": ids["admin"], "cp_code": f"{tag}-A", "phone": "9000000004",
                 "role": "admin", "is_admin": True})},
            "manager": {"Authorization": "Bearer " + _token(
                {"rm_id": ids["manager"], "phone": "+91 9000000001",
                 "role": "manager", "is_manager": True})},
            "rm": {"Authorization": "Bearer " + _token(
                {"rm_id": ids["rm"], "phone": "+91 9000000002", "role": "rm"})},
            "rm2": {"Authorization": "Bearer " + _token(
                {"rm_id": ids["rm2"], "phone": "+91 9000000003", "role": "rm"})},
        }
        yield ids
    finally:
        with conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM tickets WHERE created_by_id = ANY(%s) OR assigned_rm_id = ANY(%s)",
                            ([ids.get("admin"), ids.get("manager")], [ids.get("rm"), ids.get("rm2")]))
                cur.execute("DELETE FROM submissions WHERE id = %s", (ids.get("submission"),))
                cur.execute("DELETE FROM channel_partners WHERE id = ANY(%s)",
                            ([ids.get("admin"), ids.get("cp")],))
                cur.execute("DELETE FROM rms WHERE id = ANY(%s)",
                            ([ids.get("manager"), ids.get("rm"), ids.get("rm2")],))
        conn.close()
