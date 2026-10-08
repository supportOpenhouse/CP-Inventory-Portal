import sys; sys.path.insert(0, "backend")
from routes.webhooks import _parse_comet_message

# CP -> openhouse (inbound); text message
payload = {"data": {
    "id": "abc123", "sender": "cp_5090", "receiverType": "user",
    "receiver": "openhouse", "category": "message", "type": "text",
    "data": {"text": "hi", "metadata": {}}, "sentAt": 1751000000,
}}
m = _parse_comet_message(payload)
assert m["comet_message_id"] == "abc123"
assert m["direction"] == "inbound"
assert m["cp_id"] == 5090
assert m["sender_uid"] == "cp_5090"
assert m["body"] == "hi"
assert m["staff_id"] is None

# staff -> cp (outbound) with staff attribution in metadata
payload2 = {"data": {
    "id": "def456", "sender": "openhouse", "receiver": "cp_5090",
    "receiverType": "user", "category": "message", "type": "text",
    "data": {"text": "hello", "metadata": {"staff_id": 42}}, "sentAt": 1751000100,
}}
m2 = _parse_comet_message(payload2)
assert m2["direction"] == "outbound"
assert m2["cp_id"] == 5090
assert m2["sender_uid"] == "openhouse"
assert m2["staff_id"] == 42

# non-message event -> None
assert _parse_comet_message({"trigger": "typing_started", "data": {}}) is None
print("PASS")
