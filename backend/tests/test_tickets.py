from tests.conftest import requires_db


@requires_db
def test_admin_creates_on_submission_resolves_rm(client, graph):
    r = client.post("/api/tickets", headers=graph["headers"]["admin"],
                    json={"submission_id": graph["submission"], "title": "Broken lift"})
    assert r.status_code == 201, r.get_json()
    t = r.get_json()
    assert t["assigned_rm_id"] == graph["rm"]      # effective RM = cp.rm_id
    assert t["status"] == "open" and t["awaiting"] == "rm"
    assert t["created_by_source"] == "cp" and t["created_by_id"] == graph["admin"]


@requires_db
def test_rm_sees_only_own_manager_sees_team_other_rm_blind(client, graph):
    client.post("/api/tickets", headers=graph["headers"]["admin"],
                json={"submission_id": graph["submission"], "title": "T1"})
    assert len(client.get("/api/tickets", headers=graph["headers"]["rm"]).get_json()["items"]) == 1
    assert len(client.get("/api/tickets", headers=graph["headers"]["manager"]).get_json()["items"]) == 1
    assert client.get("/api/tickets", headers=graph["headers"]["rm2"]).get_json()["items"] == []


@requires_db
def test_reply_flips_awaiting_and_pending_count(client, graph):
    tid = client.post("/api/tickets", headers=graph["headers"]["admin"],
                      json={"submission_id": graph["submission"], "title": "T"}).get_json()["id"]
    # ball is in RM's court
    assert client.get("/api/tickets/pending-count", headers=graph["headers"]["rm"]).get_json()["count"] == 1
    # RM replies -> ball back to creator
    rr = client.post(f"/api/tickets/{tid}/reply", headers=graph["headers"]["rm"], json={"body": "on it"})
    assert rr.status_code == 200 and rr.get_json()["awaiting"] == "creator"
    assert client.get("/api/tickets/pending-count", headers=graph["headers"]["rm"]).get_json()["count"] == 0
    assert client.get("/api/tickets/pending-count", headers=graph["headers"]["admin"]).get_json()["count"] == 1


@requires_db
def test_rm2_cannot_reply_and_close_reopen_authority(client, graph):
    tid = client.post("/api/tickets", headers=graph["headers"]["admin"],
                      json={"submission_id": graph["submission"], "title": "T"}).get_json()["id"]
    assert client.post(f"/api/tickets/{tid}/reply", headers=graph["headers"]["rm2"],
                       json={"body": "x"}).status_code == 403
    assert client.post(f"/api/tickets/{tid}/close", headers=graph["headers"]["rm"]).status_code == 403
    assert client.post(f"/api/tickets/{tid}/close", headers=graph["headers"]["admin"]).status_code == 200
    assert client.post(f"/api/tickets/{tid}/reply", headers=graph["headers"]["rm"],
                       json={"body": "late"}).status_code == 409   # closed
    assert client.post(f"/api/tickets/{tid}/reopen", headers=graph["headers"]["admin"]).get_json()["awaiting"] == "rm"


@requires_db
def test_viewer_and_cp_are_rejected(client, graph):
    import time
    import jwt
    from config import Config
    viewer = "Bearer " + jwt.encode(
        {"rm_id": graph["rm"], "role": "viewer", "is_viewer": True, "phone": "x", "iat": int(time.time())},
        Config.JWT_SECRET, algorithm="HS256")
    assert client.get("/api/tickets", headers={"Authorization": viewer}).status_code == 403
