"""Standalone entrypoint for the cp_inventory_status -> submissions status sync.

Runs the SAME reconciliation the admin board triggers inline
(_sync_status_from_cp_inventory), on a schedule, so submission statuses stay
fresh without depending on someone loading the board. Reads
DATABASE_URL / PROPERTIES_DATABASE_URL / JWT_SECRET from the env via Config.

Run:   cd backend && python cron_sync_cp_status.py
Cron:  */5 * * * *   (every 5 minutes)

Idempotent and best-effort — see _sync_status_from_cp_inventory's docstring.
"""

import logging

from config import Config
from db import init_pools
from routes.admin import _sync_status_from_cp_inventory

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def main() -> None:
    Config.validate()
    init_pools()
    updated = _sync_status_from_cp_inventory()
    logging.info("[cron_sync_cp_status] done — updated %d submission(s)", updated)


if __name__ == "__main__":
    main()
