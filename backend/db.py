"""Connection pools for the app DB and (optional) properties DB.

Usage in routes:
    from db import get_app_conn, put_app_conn

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT ...")
            rows = cur.fetchall()
    finally:
        put_app_conn(conn)
"""

from typing import Optional
from psycopg2 import pool
from psycopg2.extras import RealDictCursor

from config import Config


_app_pool: Optional[pool.SimpleConnectionPool] = None
_props_pool: Optional[pool.SimpleConnectionPool] = None


def init_pools() -> None:
    """Initialize both pools. Called once at app startup."""
    global _app_pool, _props_pool

    _app_pool = pool.SimpleConnectionPool(
        minconn=1,
        maxconn=10,
        dsn=Config.DATABASE_URL,
        cursor_factory=RealDictCursor,
    )

    if Config.PROPERTIES_DATABASE_URL:
        _props_pool = pool.SimpleConnectionPool(
            minconn=1,
            maxconn=5,
            dsn=Config.PROPERTIES_DATABASE_URL,
            cursor_factory=RealDictCursor,
        )


# ---------- App DB ----------

def get_app_conn():
    if _app_pool is None:
        raise RuntimeError("App DB pool not initialized")
    return _app_pool.getconn()


def put_app_conn(conn) -> None:
    if _app_pool is not None:
        _app_pool.putconn(conn)


# ---------- Properties DB (optional) ----------

def get_props_conn():
    if _props_pool is None:
        raise RuntimeError("Properties DB not configured (set PROPERTIES_DATABASE_URL)")
    return _props_pool.getconn()


def put_props_conn(conn) -> None:
    if _props_pool is not None:
        _props_pool.putconn(conn)


def properties_configured() -> bool:
    return _props_pool is not None


# ---------- Health check ----------

def health_check() -> dict:
    """Return status of both pools (for /api/health endpoint)."""
    result = {"app": "unknown", "properties": "unknown"}

    # App DB
    try:
        conn = get_app_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 AS ok")
                cur.fetchone()
            result["app"] = "ok"
        finally:
            put_app_conn(conn)
    except Exception as e:
        result["app"] = f"error: {str(e)[:100]}"

    # Properties DB (optional)
    if not properties_configured():
        result["properties"] = "not configured"
    else:
        try:
            conn = get_props_conn()
            try:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1 AS ok")
                    cur.fetchone()
                result["properties"] = "ok"
            finally:
                put_props_conn(conn)
        except Exception as e:
            result["properties"] = f"error: {str(e)[:100]}"

    return result
