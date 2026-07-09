"""Routing asserts for the /send proxy helper. Run: ./venv/bin/python tests_comet_send.py"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
_env = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
if os.path.exists(_env):
    for _line in open(_env):
        _m = re.match(r'\s*([A-Z_]+)\s*=\s*"?([^"\n]*?)"?\s*$', _line)
        if _m:
            os.environ.setdefault(_m.group(1), _m.group(2))

from config import Config          # noqa: E402
from routes.comet import _resolve_send  # noqa: E402

STAFF = Config.COMET_STAFF_UID

# CP -> staff (inbound), cp_id from session, body cp_id ignored.
assert _resolve_send({"role": "cp", "cp_id": 143}, None) == {
    "from_uid": "cp_143", "to_uid": STAFF, "direction": "inbound", "cp_id": 143, "is_cp": True}

# admin -> CP (outbound), cp_id from body.
assert _resolve_send({"role": "admin", "cp_id": 1}, 143) == {
    "from_uid": STAFF, "to_uid": "cp_143", "direction": "outbound", "cp_id": 143, "is_cp": False}

# manager / rm -> CP (outbound); their numeric id is rm_id, not cp_id.
for role in ("manager", "rm"):
    r = _resolve_send({"role": role, "rm_id": 7}, 200)
    assert r["to_uid"] == "cp_200" and r["direction"] == "outbound" and r["is_cp"] is False, (role, r)

# CP with no cp_id -> not_cp
for bad_user in ({"role": "cp"}, {"role": "cp", "cp_id": 0}):
    try:
        _resolve_send(bad_user, None)
        assert False, "expected not_cp"
    except ValueError as e:
        assert str(e) == "not_cp", e

# staff with missing / non-int body cp_id -> cp_id_required
for bad_body in (None, "143", 1.5):
    try:
        _resolve_send({"role": "admin", "cp_id": 1}, bad_body)
        assert False, "expected cp_id_required"
    except ValueError as e:
        assert str(e) == "cp_id_required", e

print("OK: _resolve_send routing asserts passed")
