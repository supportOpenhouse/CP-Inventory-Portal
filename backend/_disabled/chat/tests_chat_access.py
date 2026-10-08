import sys; sys.path.insert(0, "backend")
from routes.comet import _resolve_error_code
# The gate returns a stable code the frontend branches on.
assert _resolve_error_code("chat_not_enabled") == "chat_not_enabled"
print("PASS")
