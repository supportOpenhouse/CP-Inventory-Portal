import sys; sys.path.insert(0, "backend")
from services_cometchat import cometchat_uid

# CP -> cp_<id>
assert cometchat_uid({"role": "cp", "cp_id": 5090}) == "cp_5090"
# staff roles -> shared openhouse uid
for role in ("admin", "manager", "rm", "viewer"):
    assert cometchat_uid({"role": role, "cp_id": None}) == "openhouse", role
print("PASS")
