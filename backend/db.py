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

import logging
from typing import Optional
import psycopg2
from psycopg2 import pool
from psycopg2.extras import RealDictCursor

from config import Config

logger = logging.getLogger("db")


_app_pool: Optional[pool.ThreadedConnectionPool] = None
_props_pool: Optional[pool.ThreadedConnectionPool] = None
_inv_pool: Optional[pool.ThreadedConnectionPool] = None


def _make_optional_pool(label: str, dsn: str):
    """Build a pool for an OPTIONAL secondary DB. Returns None (instead of
    raising) if the DB can't be reached at startup, so a misconfigured or
    down optional DB doesn't take the whole app offline. The error message is
    logged (it contains the host, not credentials) so the cause is visible.
    """
    try:
        # ThreadedConnectionPool: pool bookkeeping is locked, so the daemon
        # threads in services_email can share it with request threads safely.
        return pool.ThreadedConnectionPool(
            minconn=1,
            maxconn=10,
            dsn=dsn,
            cursor_factory=RealDictCursor,
            keepalives=1,
            keepalives_idle=30,
            keepalives_interval=10,
            keepalives_count=5,
        )
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "[db] %s DB is configured but unreachable at startup — that feature "
            "is disabled until it's fixed. (%s)", label, e,
        )
        return None


def init_pools() -> None:
    """Initialize the pools. Called once at app startup."""
    global _app_pool, _props_pool, _inv_pool

    _app_pool = pool.ThreadedConnectionPool(
        minconn=1,
        maxconn=10,
        dsn=Config.DATABASE_URL,
        cursor_factory=RealDictCursor,
        # keepalives help Neon/Render keep idle connections warm
        keepalives=1,
        keepalives_idle=30,
        keepalives_interval=10,
        keepalives_count=5,
    )

    # Properties + Inventory are OPTIONAL secondary databases. If one is
    # configured but unreachable at startup (bad/expired host, network down on a
    # dev box), DON'T crash the whole app — log a warning and leave its pool as
    # None so the dependent features degrade gracefully (the *_configured()
    # checks return False). Only the required App DB above is allowed to hard-fail.
    if Config.PROPERTIES_DATABASE_URL:
        _props_pool = _make_optional_pool("Properties", Config.PROPERTIES_DATABASE_URL)

    if Config.INVENTORY_DATABASE_URL:
        _inv_pool = _make_optional_pool("Inventory", Config.INVENTORY_DATABASE_URL)


def _is_conn_alive(conn) -> bool:
    """Ping the connection with SELECT 1. Return True if OK, False if dead."""
    try:
        if conn.closed:
            return False
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()
        return True
    except Exception:  # noqa: BLE001
        return False


# ---------- App DB ----------

def get_app_conn():
    """Get a healthy connection from the pool. Retries once if dead."""
    if _app_pool is None:
        raise RuntimeError("App DB pool not initialized")

    conn = _app_pool.getconn()
    if _is_conn_alive(conn):
        return conn

    # Dead connection — discard and get a fresh one
    logger.warning("[db] stale app connection detected; replacing")
    try:
        _app_pool.putconn(conn, close=True)
    except Exception:  # noqa: BLE001
        pass
    return _app_pool.getconn()


def put_app_conn(conn) -> None:
    if _app_pool is not None:
        try:
            _app_pool.putconn(conn)
        except psycopg2.pool.PoolError:
            # Already returned — ignore
            pass


# ---------- Properties DB (optional) ----------

def get_props_conn():
    if _props_pool is None:
        raise RuntimeError("Properties DB not configured (set PROPERTIES_DATABASE_URL)")

    conn = _props_pool.getconn()
    if _is_conn_alive(conn):
        return conn

    logger.warning("[db] stale props connection detected; replacing")
    try:
        _props_pool.putconn(conn, close=True)
    except Exception:  # noqa: BLE001
        pass
    return _props_pool.getconn()


def put_props_conn(conn) -> None:
    if _props_pool is not None:
        try:
            _props_pool.putconn(conn)
        except psycopg2.pool.PoolError:
            pass


def properties_configured() -> bool:
    return _props_pool is not None


# ---------- Inventory DB (optional, separate database) ----------

def get_inv_conn():
    if _inv_pool is None:
        raise RuntimeError("Inventory DB not configured (set INVENTORY_DATABASE_URL)")

    conn = _inv_pool.getconn()
    if _is_conn_alive(conn):
        return conn

    logger.warning("[db] stale inventory connection detected; replacing")
    try:
        _inv_pool.putconn(conn, close=True)
    except Exception:  # noqa: BLE001
        pass
    return _inv_pool.getconn()


def put_inv_conn(conn) -> None:
    if _inv_pool is not None:
        try:
            _inv_pool.putconn(conn)
        except psycopg2.pool.PoolError:
            pass


def inventory_configured() -> bool:
    return _inv_pool is not None


# ---------- Health check ----------

def health_check() -> dict:
    """Return status of both pools (for /api/health endpoint)."""
    result = {"app": "unknown", "properties": "unknown", "inventory": "unknown"}

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

    # Inventory DB (optional, separate database)
    if not inventory_configured():
        result["inventory"] = "not configured"
    else:
        try:
            conn = get_inv_conn()
            try:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1 AS ok")
                    cur.fetchone()
                result["inventory"] = "ok"
            finally:
                put_inv_conn(conn)
        except Exception as e:
            result["inventory"] = f"error: {str(e)[:100]}"

    return result